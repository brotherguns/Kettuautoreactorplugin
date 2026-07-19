const vd = window.vendetta;
const { findByProps, findByStoreName } = vd.metro;
// window.vendetta does not expose React/ReactNative directly on this build
// (vd.React is undefined even though vd.ui.assets exists), so always resolve
// them through the metro module registry.
const React = findByProps("createElement", "useState");
const RN = findByProps("View", "Text", "StyleSheet");
const { createElement: h, useState } = React;
const { View, Text, TextInput, ScrollView, Switch, StyleSheet, Alert, TouchableOpacity, Image } = RN;

const HTTP = findByProps("put", "del", "patch", "post", "get", "getAPIBaseURL");
const TokenStore = findByStoreName("UserAuthTokenStore") || findByStoreName("AuthenticationStore");
const MessageStore = findByStoreName("MessageStore");
const FD = findByProps("_interceptors");
const tokens = findByProps("unsafe_rawColors", "colors");
const UserStore = findByStoreName("UserStore");
const ThemeStore = findByStoreName("ThemeStore");
// Custom/server emoji lookup: getDisambiguatedEmojiContext().emojisByName maps a
// (disambiguated) shortcode name -> { name, id, animated }, letting us react with
// server emojis entered as ":name:" (or a bare name).
const EmojiCtx = findByProps("getDisambiguatedEmojiContext");

// Resolve a custom-emoji shortcode ("blobcat" / ":blobcat:") to "name:id" for the
// reaction API, or null if it isn't a known custom emoji on this account.
function resolveCustom(name: string): string | null {
    const full = resolveCustomFull(name);
    return full ? `${full.name}:${full.id}` : null;
}

// Same lookup but returns id + animated flag (for rendering the emoji image).
function resolveCustomFull(name: string): { name: string; id: string; animated: boolean } | null {
    try {
        const ctx = (EmojiCtx as any)?.getDisambiguatedEmojiContext?.();
        const e = ctx?.emojisByName?.[name];
        if (e?.id) return { name: e.name, id: e.id, animated: !!e.animated };
    } catch { /* store not ready — treat as unresolved */ }
    return null;
}

// window.vendetta.plugin is undefined at bundle scope (the plugin context is
// only passed as the loader's arrow param, which this IIFE doesn't consume), so
// create our own MMKV-backed storage instead of reading vd.plugin.storage.
// users map: { [userId]: { label: string, emojis: string[], enabled: boolean } }
const { createStorage, wrapSync, createMMKVBackend } = vd.storage;
const storage: Record<string, any> = wrapSync(createStorage(createMMKVBackend("AutoReact")));

// wrapSync storage hydrates asynchronously, so getUsers() can be undefined at
// first read/render. Always go through this to guarantee it exists (bracket
// access here is intentional so it isn't rewritten to a recursive call).
function getUsers(): Record<string, any> {
    if (!storage["users"]) storage["users"] = {};
    return storage["users"];
}

let interceptFn: ((p: any) => any) | null = null;

function getToken(): string {
    const ts = TokenStore as any;
    return ts.getToken ? ts.getToken() : ts.token;
}

const API_BASE = "https://discord.com/api/v9";
// Discord rate-limits reactions to ~1 per 300ms per message. We pace by the gap
// between request *starts* (not after each completes) so the network round-trip
// overlaps the wait — ~2x faster than a post-completion delay while staying clean.
const MIN_REACT_INTERVAL_MS = 320; // min gap between reaction request starts
const MAX_429_RETRIES = 5;         // per-emoji retries when rate limited
const MAX_VERIFY_ROUNDS = 3;       // re-check + re-apply passes after reacting
const VERIFY_DELAY_MS = 1200;      // let reactions settle before verifying
let lastReactStart = 0;            // shared across messages for global pacing

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// "name:id" for the reaction API path. Accepts <:name:id>, <a:name:id>, name:id,
// a custom-emoji shortcode (":name:" / bare "name"), or a unicode emoji (encoded).
function toApiEmoji(raw: string): string {
    const t = raw.trim();
    const m = /^<?a?:([^:>]+):(\d{15,})>?$/.exec(t);
    if (m) return `${m[1]}:${m[2]}`;
    const sc = /^:?([a-zA-Z0-9_~]+):?$/.exec(t);
    if (sc) {
        const resolved = resolveCustom(sc[1]);
        if (resolved) return resolved;
    }
    return encodeURIComponent(t);
}

// Canonical identity used to check a configured emoji against message.reactions.
function emojiIdentity(raw: string): { id?: string; name?: string } {
    const t = raw.trim();
    const m = /^<?a?:([^:>]+):(\d{15,})>?$/.exec(t);
    if (m) return { id: m[2] };
    const sc = /^:?([a-zA-Z0-9_~]+):?$/.exec(t);
    if (sc) {
        const resolved = resolveCustom(sc[1]);
        if (resolved) return { id: resolved.split(":")[1] };
    }
    return { name: t };
}

function putReaction(channelId: string, msgId: string, raw: string): Promise<any> {
    const url = `${API_BASE}/channels/${channelId}/messages/${msgId}/reactions/${toApiEmoji(raw)}/@me`;
    return (HTTP as any).put({ url, headers: { Authorization: getToken() } });
}

function delReaction(channelId: string, msgId: string, raw: string): Promise<any> {
    const url = `${API_BASE}/channels/${channelId}/messages/${msgId}/reactions/${toApiEmoji(raw)}/@me`;
    return (HTTP as any).del({ url, headers: { Authorization: getToken() } });
}

// Comparable identity keys so a configured emoji lines up with a message reaction.
function keyOf(id: { id?: string; name?: string }): string {
    return id.id ? "c:" + id.id : "u:" + (id.name || "");
}
function reactionKey(emoji: any): string {
    if (!emoji) return "";
    return emoji.id ? "c:" + emoji.id : "u:" + (emoji.name || "");
}

// Read the message's reactions from the LOCAL store. The REST GET /messages/{id}
// endpoint is bots-only (403 "Only bots can use this endpoint") for user tokens,
// but MessageStore mirrors our own REST reactions within ~300ms, so it's the
// reliable source. Returns null when the message isn't cached (don't touch it).
function myReactionKeysInOrder(channelId: string, msgId: string): string[] | null {
    const m = (MessageStore as any)?.getMessage?.(channelId, msgId);
    if (!m) return null;
    const out: string[] = [];
    (m.reactions || []).forEach((r: any) => { if (r?.me) out.push(reactionKey(r.emoji)); });
    return out;
}

// Wait long enough to keep reaction request starts >= the interval apart, then run
// the mutation. Retries on 429 (honouring retry_after) and transient/5xx/network
// errors; gives up on permanent 4xx (e.g. 400 Unknown Emoji, no Nitro cross-guild).
function pacedReact(mutate: () => Promise<any>, attempt: number): Promise<void> {
    const gap = Math.max(0, MIN_REACT_INTERVAL_MS - (Date.now() - lastReactStart));
    return delay(gap).then(() => {
        lastReactStart = Date.now();
        return mutate().then(
            () => undefined,
            (err: any) => {
                const status = err?.status;
                const transient = status === 429 || status == null || status >= 500;
                if (transient && attempt < MAX_429_RETRIES) {
                    const retryAfter = err?.body?.retry_after;
                    const wait = retryAfter ? Math.ceil(retryAfter * 1000) + 100 : Math.min(2000, 400 * (attempt + 1));
                    return delay(wait).then(() => pacedReact(mutate, attempt + 1));
                }
                return undefined;
            },
        );
    });
}

function applyOne(channelId: string, msgId: string, raw: string): Promise<void> {
    return pacedReact(() => putReaction(channelId, msgId, raw), 0);
}
function removeOne(channelId: string, msgId: string, raw: string): Promise<void> {
    return pacedReact(() => delReaction(channelId, msgId, raw), 0);
}

// Enforce that the message ends up with EXACTLY the configured emojis in EXACTLY
// the configured order. Reads our current reactions from the local store, finds
// the first configured emoji that's missing or out of order, then removes the
// present configured emojis from that point on and re-adds the whole tail in
// order (Discord orders reactions by when they were added, so an out-of-order or
// backfilled emoji can only be fixed by removing + re-adding it after its
// predecessors). Repeats for a few rounds to settle.
function verifyAndFix(channelId: string, msgId: string, emojis: string[], round: number): Promise<void> {
    if (round >= MAX_VERIFY_ROUNDS) return Promise.resolve();
    const myKeys = myReactionKeysInOrder(channelId, msgId);
    if (myKeys === null) return Promise.resolve(); // message not cached — trust the ordered initial pass
    const cfgKeys = emojis.map((e) => keyOf(emojiIdentity(e)));

    // First configured emoji that's missing, or present but before an earlier one.
    let firstBad = -1;
    let lastPos = -1;
    for (let i = 0; i < cfgKeys.length; i++) { // index loop, no closure capture (Hermes-safe)
        const p = myKeys.indexOf(cfgKeys[i]);
        if (p === -1 || p < lastPos) { firstBad = i; break; }
        lastPos = p;
    }
    if (firstBad === -1) return Promise.resolve(); // complete and in order

    const tail = emojis.slice(firstBad);
    const toRemove = tail.filter((e) => myKeys.indexOf(keyOf(emojiIdentity(e))) !== -1);

    let chain: Promise<void> = Promise.resolve();
    toRemove.forEach((e) => { chain = chain.then(() => removeOne(channelId, msgId, e)); });
    tail.forEach((e) => { chain = chain.then(() => applyOne(channelId, msgId, e)); });
    return chain
        .then(() => delay(VERIFY_DELAY_MS))
        .then(() => verifyAndFix(channelId, msgId, emojis, round + 1));
}

function reactToMessage(channelId: string, msgId: string, emojis: string[]) {
    // Apply sequentially in config order (not in parallel) so we don't trip the
    // reaction rate limit and drop emojis, then verify + repair order/gaps.
    // NB: forEach (not for-of) — Hermes on this build captures the loop variable
    // by reference, so for-of would react with only the last emoji.
    let chain: Promise<void> = Promise.resolve();
    emojis.forEach((emoji) => { chain = chain.then(() => applyOne(channelId, msgId, emoji)); });
    chain
        .then(() => delay(VERIFY_DELAY_MS))
        .then(() => verifyAndFix(channelId, msgId, emojis, 0))
        .catch(() => {});
}

const S = StyleSheet.create({
    container: { flex: 1, padding: 14 },

    header: { marginTop: 4, marginBottom: 4 },
    title: { fontSize: 22, fontWeight: "800", letterSpacing: 0.2 },
    subtitle: { fontSize: 13, marginTop: 3, lineHeight: 18 },
    statRow: { flexDirection: "row", marginTop: 12 },
    pill: { flexDirection: "row", alignItems: "center", borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6, marginRight: 8 },
    pillDot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
    pillTxt: { fontSize: 12, fontWeight: "700" },

    sectionTitle: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10, marginTop: 20, opacity: 0.55 },

    addToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", paddingVertical: 13, marginTop: 14 },
    addToggleTxt: { fontSize: 14, fontWeight: "700" },

    formCard: { borderRadius: 14, padding: 14, borderWidth: 1, marginTop: 12 },
    fieldLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6, marginTop: 10, opacity: 0.55 },
    input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: 1 },
    hint: { fontSize: 12, opacity: 0.5, marginTop: 6, lineHeight: 16 },

    card: { borderRadius: 14, marginBottom: 10, padding: 13 },
    cardHead: { flexDirection: "row", alignItems: "center" },
    avatar: { width: 42, height: 42, borderRadius: 21, marginRight: 12 },
    avatarFallback: { alignItems: "center", justifyContent: "center" },
    name: { fontSize: 16, fontWeight: "700" },
    uid: { fontSize: 11, opacity: 0.5, marginTop: 2 },

    emojiRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 12 },
    chip: { flexDirection: "row", alignItems: "center", justifyContent: "center", minWidth: 36, height: 36, borderRadius: 10, paddingHorizontal: 7, marginRight: 6, marginBottom: 6 },
    chipImg: { width: 22, height: 22 },
    chipTxt: { fontSize: 19 },
    noEmoji: { fontSize: 13, opacity: 0.4, marginTop: 12, fontStyle: "italic" },

    actions: { flexDirection: "row", marginTop: 12 },
    actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 10, paddingVertical: 10, marginRight: 8 },
    actTxt: { fontSize: 13, fontWeight: "700" },

    primaryBtn: { borderRadius: 11, paddingVertical: 13, alignItems: "center", marginTop: 14 },
    primaryTxt: { fontSize: 15, fontWeight: "700" },
    ghostBtn: { borderRadius: 11, paddingVertical: 12, alignItems: "center", marginTop: 8 },

    emptyWrap: { alignItems: "center", marginTop: 36, paddingHorizontal: 24 },
    emptyIcon: { fontSize: 42, marginBottom: 12 },
    emptyTxt: { fontSize: 15, fontWeight: "700", textAlign: "center" },
    emptySub: { fontSize: 13, opacity: 0.5, textAlign: "center", marginTop: 5, lineHeight: 18 },

    previewLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.55, marginTop: 14, marginBottom: 8 },
    backTxt: { fontSize: 15, fontWeight: "700" },
});

// Resolve a Discord semantic color token to a hex string for the ACTIVE theme.
// tokens.colors[KEY] is an opaque SemanticColor object (serializes as {}), which
// RN can't use directly as a color in this settings tree — passing it renders as
// black/invalid, making the UI unreadable on dark/AMOLED themes like "midnight".
// Resolve it via tokens.internal.resolveSemanticColor; fall back to a fixed color
// when the key isn't a known semantic color (e.g. the blurple brand).
function c(key: string, fallback: string): string {
    try {
        const t = tokens as any;
        const sc = t?.colors?.[key];
        const resolve = t?.internal?.resolveSemanticColor;
        if (sc && resolve) {
            const out = resolve((ThemeStore as any)?.theme, sc);
            if (typeof out === "string" && out) return out;
        }
    } catch { /* fall through to fallback */ }
    return fallback;
}

// How to render a stored emoji token in the UI: a custom-emoji CDN image, or text.
function emojiDisplay(raw: string): { uri?: string; text?: string } {
    const t = raw.trim();
    const m = /^<?(a)?:([^:>]+):(\d{15,})>?$/.exec(t);
    if (m) return { uri: `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] === "a" ? "gif" : "png"}?size=48` };
    const sc = /^:?([a-zA-Z0-9_~]+):?$/.exec(t);
    if (sc) {
        const full = resolveCustomFull(sc[1]);
        if (full) return { uri: `https://cdn.discordapp.com/emojis/${full.id}.${full.animated ? "gif" : "png"}?size=48` };
    }
    return { text: t };
}

function EmojiChip({ raw }: any) {
    const d = emojiDisplay(raw);
    return h(View, { style: [S.chip, { backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22") }] },
        d.uri
            ? h(Image, { source: { uri: d.uri }, style: S.chipImg })
            : h(Text, { style: S.chipTxt }, d.text));
}

function avatarUri(userId: string): string | null {
    try {
        const u = (UserStore as any)?.getUser?.(userId);
        if (u?.getAvatarURL) return u.getAvatarURL(null, 128, true);
        if (u?.avatar) return `https://cdn.discordapp.com/avatars/${userId}/${u.avatar}.png?size=128`;
    } catch { /* not cached */ }
    return null;
}

function Avatar({ userId, label }: any) {
    const uri = avatarUri(userId);
    if (uri) return h(Image, { source: { uri }, style: S.avatar });
    const initial = ((label || "?").trim().charAt(0) || "?").toUpperCase();
    return h(View, { style: [S.avatar, S.avatarFallback, { backgroundColor: c("BRAND_500", "#5865f2") }] },
        h(Text, { style: { color: "#fff", fontWeight: "800", fontSize: 17 } }, initial));
}

// Split a settings text field into individual emojis. There's no Intl.Segmenter
// on this build, and the OS emoji keyboard inserts emojis with no separators, so
// a plain whitespace split leaves several emojis mashed into one token — and only
// that one "emoji" ever reacts. Split each whitespace/comma token into emoji
// grapheme clusters via a Unicode-property regex; custom Discord emoji tokens
// (<:name:id>, <a:name:id>, name:id) are kept intact.
const EMOJI_CLUSTER_RE = /(?:<a?:[^:>\s]+:\d{15,}>)|(?:\p{Regional_Indicator}\p{Regional_Indicator})|(?:[\d#*]️?⃣)|(?:\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️)?(?:‍\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️)?)*)/gu;
function parseEmojis(text: string): string[] {
    const out: string[] = [];
    const tokens = text.trim().split(/[\s,]+/).filter(Boolean);
    tokens.forEach((tok) => {
        if (/^:?[^:>\s]+:\d{15,}$/.test(tok)) { out.push(tok); return; }
        const m = tok.match(EMOJI_CLUSTER_RE);
        if (m && m.length) m.forEach((e) => out.push(e));
        else out.push(tok);
    });
    return out;
}

function UserCard({ userId, onToggle, onDelete, onEdit }: any) {
    const cfg = getUsers()[userId];
    const on = !!cfg.enabled;
    return h(View, { style: [S.card, { backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31") }] },
        h(View, { style: S.cardHead },
            h(View, { style: { opacity: on ? 1 : 0.4 } }, h(Avatar, { userId, label: cfg.label })),
            h(View, { style: { flex: 1, opacity: on ? 1 : 0.4 } },
                h(Text, { style: [S.name, { color: c("HEADER_PRIMARY", "#fff") }] }, cfg.label || userId),
                h(Text, { style: [S.uid, { color: c("TEXT_MUTED", "#949ba4") }] }, "ID: " + userId),
            ),
            h(Switch, {
                value: on,
                onValueChange: (v: boolean) => onToggle(userId, v),
                trackColor: { true: c("BRAND_500", "#5865f2"), false: c("BACKGROUND_TERTIARY", "#1e1f22") },
            }),
        ),
        h(View, { style: [S.emojiRow, { opacity: on ? 1 : 0.4 }] },
            cfg.emojis?.length > 0
                ? cfg.emojis.map((e: string, i: number) => h(EmojiChip, { key: i, raw: e }))
                : h(Text, { style: [S.noEmoji, { color: c("TEXT_MUTED", "#949ba4") }] }, "No emojis set"),
        ),
        h(View, { style: S.actions },
            h(TouchableOpacity, {
                style: [S.actBtn, { backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22") }],
                onPress: () => onEdit(userId),
            }, h(Text, { style: [S.actTxt, { color: c("TEXT_NORMAL", "#dbdee1") }] }, "\u270E  Edit emojis")),
            h(TouchableOpacity, {
                style: [S.actBtn, { backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22"), marginRight: 0, flex: 0, paddingHorizontal: 16 }],
                onPress: () => onDelete(userId),
            }, h(Text, { style: [S.actTxt, { color: c("TEXT_DANGER", "#f23f43") }] }, "Remove")),
        ),
    );
}

function Settings() {
    const [tick, setTick] = useState(0);
    const refresh = () => setTick((n: number) => n + 1);

    const [adding, setAdding] = useState(false);
    const [newId, setNewId] = useState("");
    const [newLabel, setNewLabel] = useState("");
    const [newEmojis, setNewEmojis] = useState("");
    const [editTarget, setEditTarget] = useState<string | null>(null);
    const [editInput, setEditInput] = useState("");

    const inputStyle = [S.input, {
        color: c("TEXT_NORMAL", "#fff"),
        backgroundColor: c("INPUT_BACKGROUND", "#1e1f22"),
        borderColor: c("BORDER_SUBTLE", "#3f4147"),
    }];

    function handleAdd() {
        const uid = newId.trim();
        if (!uid) return;
        getUsers()[uid] = { label: newLabel.trim() || uid, emojis: parseEmojis(newEmojis), enabled: true };
        setNewId(""); setNewLabel(""); setNewEmojis(""); setAdding(false);
        refresh();
    }

    function handleDelete(uid: string) {
        Alert.alert("Remove user", `Stop auto-reacting to ${getUsers()[uid]?.label || uid}?`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => { delete getUsers()[uid]; refresh(); } },
        ]);
    }

    function handleEdit(uid: string) {
        setEditTarget(uid);
        setEditInput((getUsers()[uid]?.emojis || []).join(" "));
    }

    function handleSaveEmojis() {
        if (!editTarget) return;
        getUsers()[editTarget].emojis = parseEmojis(editInput);
        setEditTarget(null);
        refresh();
    }

    // ----- Edit emojis screen (with live preview) -----
    if (editTarget && getUsers()[editTarget]) {
        const preview = parseEmojis(editInput);
        return h(ScrollView, { style: [S.container, { backgroundColor: c("BACKGROUND_PRIMARY", "#313338") }] },
            h(TouchableOpacity, { style: { marginTop: 4, marginBottom: 6 }, onPress: () => setEditTarget(null) },
                h(Text, { style: [S.backTxt, { color: c("TEXT_LINK", "#00a8fc") }] }, "\u2039  Back")),
            h(Text, { style: [S.title, { color: c("HEADER_PRIMARY", "#fff"), fontSize: 19 }] },
                getUsers()[editTarget].label || editTarget),
            h(Text, { style: [S.subtitle, { color: c("TEXT_MUTED", "#949ba4") }] }, "Reactions added to their messages"),

            h(Text, { style: [S.fieldLabel, { color: c("TEXT_NORMAL", "#dbdee1"), marginTop: 18 }] }, "Emojis"),
            h(TextInput, {
                style: [inputStyle, { minHeight: 52 }], value: editInput, onChangeText: setEditInput,
                placeholder: "\uD83D\uDC4D \uD83D\uDD25 :blobcat:",
                placeholderTextColor: c("TEXT_MUTED", "#87898c"), multiline: true,
            }),
            h(Text, { style: [S.hint, { color: c("TEXT_MUTED", "#949ba4") }] },
                "Separate with spaces. Server emojis: type :name: (Nitro needed for other servers)."),

            h(Text, { style: [S.previewLabel, { color: c("TEXT_NORMAL", "#dbdee1") }] },
                `Preview (${preview.length})`),
            preview.length > 0
                ? h(View, { style: { flexDirection: "row", flexWrap: "wrap" } }, preview.map((e, i) => h(EmojiChip, { key: i, raw: e })))
                : h(Text, { style: [S.noEmoji, { color: c("TEXT_MUTED", "#949ba4"), marginTop: 0 }] }, "Nothing yet"),

            h(TouchableOpacity, { style: [S.primaryBtn, { backgroundColor: c("BRAND_500", "#5865f2") }], onPress: handleSaveEmojis },
                h(Text, { style: [S.primaryTxt, { color: "#fff" }] }, "Save")),
        );
    }

    // ----- Main screen -----
    const userKeys = Object.keys(getUsers());
    const activeCount = userKeys.filter((u) => getUsers()[u]?.enabled).length;

    return h(ScrollView, { style: [S.container, { backgroundColor: c("BACKGROUND_PRIMARY", "#313338") }] },
        h(View, { style: S.header },
            h(Text, { style: [S.title, { color: c("HEADER_PRIMARY", "#fff") }] }, "AutoReact"),
            h(Text, { style: [S.subtitle, { color: c("TEXT_MUTED", "#949ba4") }] },
                "Automatically react to messages from the users you watch."),
            h(View, { style: S.statRow },
                h(View, { style: [S.pill, { backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31") }] },
                    h(View, { style: [S.pillDot, { backgroundColor: c("BRAND_500", "#5865f2") }] }),
                    h(Text, { style: [S.pillTxt, { color: c("TEXT_NORMAL", "#dbdee1") }] }, `${userKeys.length} watched`)),
                h(View, { style: [S.pill, { backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31") }] },
                    h(View, { style: [S.pillDot, { backgroundColor: activeCount > 0 ? c("STATUS_GREEN_500", "#23a55a") : c("TEXT_MUTED", "#949ba4") }] }),
                    h(Text, { style: [S.pillTxt, { color: c("TEXT_NORMAL", "#dbdee1") }] }, `${activeCount} active`)),
            ),
        ),

        adding
            ? h(View, { style: [S.formCard, { backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31"), borderColor: c("BORDER_SUBTLE", "#3f4147") }] },
                h(Text, { style: [S.fieldLabel, { color: c("TEXT_NORMAL", "#dbdee1"), marginTop: 0 }] }, "Display name (optional)"),
                h(TextInput, { style: inputStyle, value: newLabel, onChangeText: setNewLabel, placeholder: "John Doe", placeholderTextColor: c("TEXT_MUTED", "#87898c") }),
                h(Text, { style: [S.fieldLabel, { color: c("TEXT_NORMAL", "#dbdee1") }] }, "User ID"),
                h(TextInput, { style: inputStyle, value: newId, onChangeText: setNewId, placeholder: "123456789012345678", placeholderTextColor: c("TEXT_MUTED", "#87898c"), keyboardType: "numeric" }),
                h(Text, { style: [S.fieldLabel, { color: c("TEXT_NORMAL", "#dbdee1") }] }, "Emojis"),
                h(TextInput, { style: inputStyle, value: newEmojis, onChangeText: setNewEmojis, placeholder: "\uD83D\uDC4D \uD83D\uDD25 :blobcat:", placeholderTextColor: c("TEXT_MUTED", "#87898c") }),
                h(Text, { style: [S.hint, { color: c("TEXT_MUTED", "#949ba4") }] }, "Server emojis: type :name:"),
                h(TouchableOpacity, {
                    style: [S.primaryBtn, { backgroundColor: newId.trim() ? c("BRAND_500", "#5865f2") : c("BACKGROUND_TERTIARY", "#1e1f22") }],
                    onPress: handleAdd,
                }, h(Text, { style: [S.primaryTxt, { color: newId.trim() ? "#fff" : c("TEXT_MUTED", "#949ba4") }] }, "Add user")),
                h(TouchableOpacity, { style: S.ghostBtn, onPress: () => { setAdding(false); setNewId(""); setNewLabel(""); setNewEmojis(""); } },
                    h(Text, { style: [S.primaryTxt, { color: c("TEXT_MUTED", "#949ba4") }] }, "Cancel")),
            )
            : h(TouchableOpacity, {
                style: [S.addToggle, { borderColor: c("BRAND_500", "#5865f2") }],
                onPress: () => setAdding(true),
            }, h(Text, { style: [S.addToggleTxt, { color: c("BRAND_500", "#5865f2") }] }, "\uFF0B  Add a user")),

        h(Text, { style: [S.sectionTitle, { color: c("TEXT_NORMAL", "#fff") }] }, "Watched users"),
        userKeys.length === 0
            ? h(View, { style: S.emptyWrap },
                h(Text, { style: S.emptyIcon }, "\uD83D\uDC40"),
                h(Text, { style: [S.emptyTxt, { color: c("TEXT_NORMAL", "#dbdee1") }] }, "No one watched yet"),
                h(Text, { style: [S.emptySub, { color: c("TEXT_MUTED", "#949ba4") }] }, "Add a user above and pick the emojis you want dropped on their messages."))
            : userKeys.map((uid) => h(UserCard, {
                key: uid + tick, userId: uid,
                onToggle: (u: string, v: boolean) => { getUsers()[u].enabled = v; refresh(); },
                onDelete: handleDelete, onEdit: handleEdit,
            })),
    );
}

export default {
    onLoad() {
        interceptFn = (payload: any) => {
            if (payload.type !== "MESSAGE_CREATE" || payload.optimistic) return null;
            const authorId = payload.message?.author?.id;
            if (!authorId) return null;
            const cfg = getUsers()[authorId];
            if (cfg?.enabled && cfg.emojis?.length > 0) {
                reactToMessage(payload.channelId, payload.message.id, cfg.emojis);
            }
            return null;
        };
        (FD as any)._interceptors.push(interceptFn);
    },
    onUnload() {
        if (interceptFn) {
            (FD as any)._interceptors = (FD as any)._interceptors.filter((f: any) => f !== interceptFn);
            interceptFn = null;
        }
    },
    settings: Settings,
};
