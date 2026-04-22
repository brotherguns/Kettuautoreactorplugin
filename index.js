(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    //  Vendetta core imports
    // ─────────────────────────────────────────────────────────────
    const vd = window.vendetta;
    const { findByProps, findByStoreName } = vd.metro;
    const { createStorage, wrapSync, createMMKVBackend } = vd.storage;

    const React = findByProps("createElement", "useState");
    const RN    = findByProps("View", "Text", "StyleSheet");
    const { createElement: h, useState, useEffect, useMemo, useCallback } = React;
    const {
        View, Text, TextInput, ScrollView, Switch, Modal,
        StyleSheet, Alert, TouchableOpacity, Image, ActivityIndicator
    } = RN;

    const HTTP                = findByProps("put", "del", "patch", "post", "get", "getAPIBaseURL");
    const TokenStore          = findByStoreName("AuthenticationStore");
    const FD                  = findByProps("_interceptors");
    const EmojiStore          = findByStoreName("EmojiStore");
    const GuildStore          = findByStoreName("GuildStore");
    const SelectedGuildStore  = findByStoreName("SelectedGuildStore");
    const MessageStore        = findByStoreName("MessageStore");
    const SelectedChannelStore= findByStoreName("SelectedChannelStore");
    const UserStore           = findByStoreName("UserStore");           // ← Nitro check
    const tokens              = findByProps("unsafe_rawColors", "colors");

    const storage = wrapSync(createStorage(createMMKVBackend("AutoReact")));
    let interceptFn = null;

    // ─────────────────────────────────────────────────────────────
    //  Utility helpers
    // ─────────────────────────────────────────────────────────────
    function normalizeEmoji(str) { return str.replace(/\uFE0F/g, ""); }

    function emojiToReactionString(e) {
        if (!e.id) return normalizeEmoji(e.name);
        return (e.animated ? "a:" : "") + e.name + ":" + e.id;
    }
    function getCustomEmojiId(rs)   { const m = rs.match(/:(\d+)$/); return m ? m[1] : null; }
    function getCustomEmojiName(rs) {
        const p = rs.split(":");
        if (p.length === 2) return p[0];
        if (p.length === 3 && p[0] === "a") return p[1];
        return null;
    }
    function getToken() { return TokenStore.getToken(); }
    function guildIconUrl(guild) {
        if (!guild.icon) return null;
        return "https://cdn.discordapp.com/icons/" + guild.id + "/" + guild.icon + ".webp?size=32";
    }
    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    // ─────────────────────────────────────────────────────────────
    //  Nitro / Premium detection
    //  premium_type: 0 = None, 1 = Classic, 2 = Nitro, 3 = Basic
    // ─────────────────────────────────────────────────────────────
    function hasNitro() {
        try {
            const me = UserStore.getCurrentUser();
            return me && (me.premium_type === 1 || me.premium_type === 2);
        } catch (_) { return false; }
    }

    // ─────────────────────────────────────────────────────────────
    //  Reaction API calls
    // ─────────────────────────────────────────────────────────────
    function reactToMessage(channelId, msgId, emojis) {
        const token = getToken();
        emojis.forEach(function (emoji, i) {
            setTimeout(function () {
                const encoded = encodeURIComponent(normalizeEmoji(emoji));
                const url = "https://discord.com/api/v9/channels/" + channelId +
                            "/messages/" + msgId + "/reactions/" + encoded + "/@me";
                HTTP.put({ url, headers: { Authorization: token } }).catch(function () {});
            }, i * 350);
        });
    }

    // Staggered async PUT — respects rate limits via sequential awaits
    async function addReaction(channelId, msgId, emoji, superReaction) {
        const token   = getToken();
        const encoded = encodeURIComponent(normalizeEmoji(emoji));
        let url = "https://discord.com/api/v9/channels/" + channelId +
                  "/messages/" + msgId + "/reactions/" + encoded + "/@me";
        if (superReaction) url += "?type=1";
        await HTTP.put({ url, headers: { Authorization: token } }).catch(() => {});
    }

    async function removeReaction(channelId, msgId, emoji) {
        const token   = getToken();
        const encoded = encodeURIComponent(normalizeEmoji(emoji));
        const url = "https://discord.com/api/v9/channels/" + channelId +
                    "/messages/" + msgId + "/reactions/" + encoded + "/@me";
        await HTTP.del({ url, headers: { Authorization: token } }).catch(() => {});
    }

    // ─────────────────────────────────────────────────────────────
    //  Fetch messages for a specific user via REST (no DB storage)
    //  Scans backwards through channel history until `limit` messages
    //  from `userId` are collected or we run out of history.
    // ─────────────────────────────────────────────────────────────
    async function fetchUserMessages(channelId, userId, limit) {
        const token    = getToken();
        const base     = "https://discord.com/api/v9/channels/" + channelId + "/messages";
        const collected = [];
        let before     = null;
        const MAX_PAGES = 10; // safety cap — avoids runaway loops

        for (let page = 0; page < MAX_PAGES && collected.length < limit; page++) {
            const batchSize = Math.min(100, (limit - collected.length) * 3); // over-fetch to find user msgs
            let url = base + "?limit=" + batchSize;
            if (before) url += "&before=" + before;

            let msgs;
            try {
                const res = await HTTP.get({ url, headers: { Authorization: token } });
                msgs = Array.isArray(res.body) ? res.body : [];
            } catch (_) { break; }

            if (!msgs.length) break;

            for (const m of msgs) {
                if (m.author?.id === userId && collected.length < limit) {
                    collected.push(m);
                }
            }

            before = msgs[msgs.length - 1].id;
            await delay(300); // respect rate limits between pages
        }

        return collected;
    }

    // ─────────────────────────────────────────────────────────────
    //  One-Time Reaction  — /add
    //  No data written to storage; pure ephemeral loop
    // ─────────────────────────────────────────────────────────────
    async function oneTimeAdd({ channelId, userId, emojis, messageCount, superReaction, onProgress, onDone }) {
        onProgress("Fetching messages…");
        const msgs = await fetchUserMessages(channelId, userId, messageCount);
        if (!msgs.length) { onDone(0, "No messages found for that user in this channel."); return; }

        onProgress("Applying reactions to " + msgs.length + " message(s)…");
        for (let i = 0; i < msgs.length; i++) {
            for (let j = 0; j < emojis.length; j++) {
                await addReaction(channelId, msgs[i].id, emojis[j], superReaction);
                await delay(400); // stagger to avoid rate limit
            }
            onProgress("Reacted to " + (i + 1) + "/" + msgs.length + " message(s)…");
        }
        onDone(msgs.length, null);
    }

    // ─────────────────────────────────────────────────────────────
    //  One-Time Reaction  — /remove
    // ─────────────────────────────────────────────────────────────
    async function oneTimeRemove({ channelId, userId, emojis, messageCount, onProgress, onDone }) {
        onProgress("Fetching messages…");
        const msgs = await fetchUserMessages(channelId, userId, messageCount);
        if (!msgs.length) { onDone(0, "No messages found."); return; }

        onProgress("Removing reactions from " + msgs.length + " message(s)…");
        for (let i = 0; i < msgs.length; i++) {
            for (let j = 0; j < emojis.length; j++) {
                await removeReaction(channelId, msgs[i].id, emojis[j]);
                await delay(400);
            }
            onProgress("Cleared " + (i + 1) + "/" + msgs.length + " message(s)…");
        }
        onDone(msgs.length, null);
    }

    // ─────────────────────────────────────────────────────────────
    //  Existing auto-react on new messages (unchanged behaviour)
    // ─────────────────────────────────────────────────────────────
    function reactToExisting(userId) {
        const cfg = storage.users?.[userId];
        if (!cfg?.enabled || !cfg.emojis?.length) return;
        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) return;
        const msgs = MessageStore.getMessages(channelId);
        const arr  = msgs?._array || msgs?.toArray?.() || [];
        const userMsgs = arr.filter(m => m.author?.id === userId).slice(-20);
        userMsgs.forEach(function (msg, i) {
            setTimeout(function () { reactToMessage(channelId, msg.id, cfg.emojis); }, i * cfg.emojis.length * 400);
        });
    }

    // ─────────────────────────────────────────────────────────────
    //  Styles
    // ─────────────────────────────────────────────────────────────
    const S = StyleSheet.create({
        container:       { flex: 1, padding: 16 },
        sectionTitle:    { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8, marginTop: 16, opacity: 0.5 },
        card:            { borderRadius: 14, marginBottom: 10, padding: 14 },
        row:             { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
        label:           { fontSize: 15, fontWeight: "700", flex: 1 },
        uid:             { fontSize: 11, opacity: 0.45, marginTop: 2 },
        emojiRow:        { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
        chip:            { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, marginRight: 5, marginBottom: 5, flexDirection: "row", alignItems: "center" },
        input:           { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 8, borderWidth: 1 },
        btn:             { borderRadius: 10, padding: 12, alignItems: "center", marginTop: 4 },
        btnTxt:          { fontSize: 14, fontWeight: "700" },
        smBtn:           { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginLeft: 6 },
        smTxt:           { fontSize: 12, fontWeight: "700" },
        hint:            { fontSize: 11, opacity: 0.45, marginBottom: 6 },
        empty:           { textAlign: "center", opacity: 0.35, marginTop: 40, fontSize: 15 },
        emojiPickerItem: { width: 60, height: 68, alignItems: "center", justifyContent: "center", borderRadius: 10, margin: 3, padding: 4 },
        emojiPickerImg:  { width: 38, height: 38, borderRadius: 6 },
        emojiPickerTxt:  { fontSize: 9, marginTop: 3, textAlign: "center" },
        guildPill:       { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginRight: 8, marginBottom: 4, flexDirection: "row", alignItems: "center" },
        guildIcon:       { width: 22, height: 22, borderRadius: 6, marginRight: 6 },
        tabRow:          { flexDirection: "row", marginBottom: 14, marginTop: 4 },
        tab:             { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7, marginRight: 8 },
        tabTxt:          { fontSize: 13, fontWeight: "700" },
        searchResultGuild: { fontSize: 9, marginTop: 2, textAlign: "center", opacity: 0.6 },
        divider:         { height: 1, opacity: 0.08, marginVertical: 12 },
        // Modal overlay
        modalOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
        modalSheet:      { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
        modalHandle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: "#ffffff33", alignSelf: "center", marginBottom: 16 },
        modalTitle:      { fontSize: 18, fontWeight: "800", marginBottom: 14 },
        modalRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
        modalLabel:      { fontSize: 15, fontWeight: "600" },
        modalSub:        { fontSize: 11, opacity: 0.45, marginTop: 2 },
        // Status banner
        statusBanner:    { borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: "row", alignItems: "center" },
        statusDot:       { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
        statusText:      { fontSize: 13, fontWeight: "600", flex: 1 },
        // Section header with badge
        sectionRow:      { flexDirection: "row", alignItems: "center", marginBottom: 6, marginTop: 16 },
        badge:           { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8 },
        badgeTxt:        { fontSize: 10, fontWeight: "700" },
        // Stepper
        stepperRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 10, padding: 12, marginBottom: 8 },
        stepperBtn:      { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
        stepperVal:      { fontSize: 18, fontWeight: "700", minWidth: 32, textAlign: "center" },
    });

    function c(key, fallback) {
        return tokens?.colors?.[key] || fallback;
    }

    // ─────────────────────────────────────────────────────────────
    //  Shared sub-components
    // ─────────────────────────────────────────────────────────────
    function GuildIconView({ guild, size }) {
        const sz     = size || 22;
        const iconUrl = guildIconUrl(guild);
        if (iconUrl) {
            return h(Image, { source: { uri: iconUrl }, style: { width: sz, height: sz, borderRadius: sz / 3, marginRight: 6 } });
        }
        const colors = ["#5865f2","#57f287","#fee75c","#eb459e","#ed4245","#faa61a"];
        const bg     = colors[parseInt(guild.id.slice(-2), 10) % colors.length];
        return h(View, {
            style: { width: sz, height: sz, borderRadius: sz / 3, marginRight: 6, backgroundColor: bg, alignItems: "center", justifyContent: "center" }
        }, h(Text, { style: { fontSize: sz * 0.5, fontWeight: "700", color: "#fff" } }, guild.name.charAt(0).toUpperCase()));
    }

    function EmojiChip({ reactionStr, onRemove }) {
        const id   = getCustomEmojiId(reactionStr);
        const name = getCustomEmojiName(reactionStr);
        const imgUrl = id ? "https://cdn.discordapp.com/emojis/" + id + ".webp?size=32" : null;
        return h(View, { style: [S.chip, { backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22") }] },
            imgUrl
                ? h(Image, { source: { uri: imgUrl }, style: { width: 20, height: 20, borderRadius: 4, marginRight: 4 } })
                : h(Text, { style: { fontSize: 18 } }, reactionStr),
            name ? h(Text, { style: { fontSize: 11, color: c("TEXT_MUTED", "#aaa") } }, ":" + name + ":") : null,
            onRemove
                ? h(TouchableOpacity, { onPress: onRemove, style: { marginLeft: 5 } },
                    h(Text, { style: { fontSize: 12, color: c("TEXT_MUTED", "#aaa") } }, "✕"))
                : null
        );
    }

    // Numeric stepper control
    function Stepper({ value, min, max, onChange }) {
        const brand = c("BRAND_NEW", "#5865f2");
        return h(View, { style: { flexDirection: "row", alignItems: "center" } },
            h(TouchableOpacity, {
                style: [S.stepperBtn, { backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22") }],
                onPress: () => onChange(Math.max(min, value - 1))
            }, h(Text, { style: { fontSize: 20, fontWeight: "700", color: c("TEXT_NORMAL", "#fff") } }, "−")),
            h(Text, { style: [S.stepperVal, { color: c("TEXT_NORMAL", "#fff") }] }, String(value)),
            h(TouchableOpacity, {
                style: [S.stepperBtn, { backgroundColor: brand }],
                onPress: () => onChange(Math.min(max, value + 1))
            }, h(Text, { style: { fontSize: 20, fontWeight: "700", color: "#fff" } }, "+"))
        );
    }

    // ─────────────────────────────────────────────────────────────
    //  Quick React Modal  — the "One-Time Reaction" panel
    //  Rendered as a bottom sheet modal over the settings page
    // ─────────────────────────────────────────────────────────────
    function QuickReactModal({ visible, mode, onClose }) {
        // mode = "add" | "remove"
        const [userId,       setUserId]       = useState("");
        const [emojiInput,   setEmojiInput]   = useState("");
        const [msgCount,     setMsgCount]     = useState(5);
        const [superReact,   setSuperReact]   = useState(false);
        const [running,      setRunning]      = useState(false);
        const [statusText,   setStatusText]   = useState("");
        const [resultText,   setResultText]   = useState("");
        const nitro = hasNitro();

        const brand  = c("BRAND_NEW", "#5865f2");
        const danger = c("STATUS_DANGER", "#ed4245");
        const bgSec  = c("BACKGROUND_SECONDARY", "#2b2d31");
        const bgTer  = c("BACKGROUND_TERTIARY", "#1e1f22");
        const textNorm  = c("TEXT_NORMAL", "#fff");
        const textMuted = c("TEXT_MUTED", "#aaa");

        function reset() {
            setUserId(""); setEmojiInput(""); setMsgCount(5);
            setSuperReact(false); setRunning(false);
            setStatusText(""); setResultText("");
        }

        function handleClose() { reset(); onClose(); }

        function parseEmojis() {
            return emojiInput.trim().split(/[\s,]+/).map(e => normalizeEmoji(e.trim())).filter(Boolean);
        }

        async function handleRun() {
            const channelId = SelectedChannelStore.getChannelId();
            if (!channelId) { Alert.alert("No Channel", "Open a channel first."); return; }
            const uid    = userId.trim();
            const emojis = parseEmojis();
            if (!uid)          { Alert.alert("Missing User ID", "Enter a Discord User ID."); return; }
            if (!emojis.length){ Alert.alert("Missing Emojis",  "Enter at least one emoji."); return; }

            setRunning(true); setResultText("");

            if (mode === "add") {
                await oneTimeAdd({
                    channelId, userId: uid, emojis,
                    messageCount: msgCount,
                    superReaction: nitro && superReact,
                    onProgress: setStatusText,
                    onDone: (count, err) => {
                        setRunning(false);
                        setResultText(err ? "⚠️ " + err : "✅ Reacted to " + count + " message(s).");
                    }
                });
            } else {
                await oneTimeRemove({
                    channelId, userId: uid, emojis,
                    messageCount: msgCount,
                    onProgress: setStatusText,
                    onDone: (count, err) => {
                        setRunning(false);
                        setResultText(err ? "⚠️ " + err : "✅ Removed reactions from " + count + " message(s).");
                    }
                });
            }
        }

        return h(Modal, {
            visible, transparent: true, animationType: "slide",
            onRequestClose: handleClose
        },
            h(View, { style: S.modalOverlay },
                h(TouchableOpacity, { style: { flex: 1 }, activeOpacity: 1, onPress: handleClose }),
                h(View, { style: [S.modalSheet, { backgroundColor: bgSec }] },
                    h(View, { style: S.modalHandle }),

                    // ── Title row ──
                    h(View, { style: { flexDirection: "row", alignItems: "center", marginBottom: 14 } },
                        h(Text, { style: [S.modalTitle, { color: textNorm, flex: 1 }] },
                            mode === "add" ? "⚡  Quick React  /add" : "🗑️  Remove Reactions  /remove"),
                        h(TouchableOpacity, { onPress: handleClose },
                            h(Text, { style: { fontSize: 22, color: textMuted } }, "✕"))
                    ),

                    // ── Status / result banner ──
                    (running || resultText) ? h(View, {
                        style: [S.statusBanner, {
                            backgroundColor: running ? "#5865f220" : resultText.startsWith("✅") ? "#57f28720" : "#ed424520"
                        }]
                    },
                        running
                            ? h(ActivityIndicator, { color: brand, style: { marginRight: 10 } })
                            : h(View, { style: [S.statusDot, { backgroundColor: resultText.startsWith("✅") ? "#57f287" : "#ed4245" }] }),
                        h(Text, { style: [S.statusText, { color: textNorm }] }, running ? statusText : resultText)
                    ) : null,

                    // ── User ID ──
                    h(Text, { style: [S.hint, { color: textMuted }] }, "Target User ID"),
                    h(TextInput, {
                        style: [S.input, { color: textNorm, backgroundColor: bgTer, borderColor: bgTer }],
                        value: userId, onChangeText: setUserId,
                        placeholder: "123456789012345678",
                        placeholderTextColor: textMuted, keyboardType: "numeric", editable: !running
                    }),

                    // ── Emoji input ──
                    h(Text, { style: [S.hint, { color: textMuted }] }, "Emoji(s) — space or comma separated (unicode or custom :name:id)"),
                    h(TextInput, {
                        style: [S.input, { color: textNorm, backgroundColor: bgTer, borderColor: bgTer }],
                        value: emojiInput, onChangeText: setEmojiInput,
                        placeholder: "👍 🔥 or customname:123456",
                        placeholderTextColor: textMuted, editable: !running
                    }),

                    // ── Message count stepper ──
                    h(View, { style: [S.stepperRow, { backgroundColor: bgTer }] },
                        h(View, null,
                            h(Text, { style: [S.modalLabel, { color: textNorm }] }, "Messages to scan"),
                            h(Text, { style: [S.modalSub, { color: textMuted }] }, "Last N messages from user")
                        ),
                        h(Stepper, { value: msgCount, min: 1, max: 50, onChange: setMsgCount })
                    ),

                    // ── Super Reaction toggle (Nitro only, add mode only) ──
                    mode === "add" ? h(View, { style: [S.modalRow, { backgroundColor: bgTer, borderRadius: 10, paddingHorizontal: 12, marginBottom: 8 }] },
                        h(View, { style: { flex: 1 } },
                            h(Text, { style: [S.modalLabel, { color: nitro ? textNorm : textMuted }] },
                                "⚡ Super Reaction (Burst)"),
                            h(Text, { style: [S.modalSub, { color: textMuted }] },
                                nitro ? "Apply as Burst Reactions" : "Requires Nitro — not detected")
                        ),
                        h(Switch, {
                            value: superReact && nitro,
                            onValueChange: (v) => { if (nitro) setSuperReact(v); },
                            disabled: !nitro || running,
                            trackColor: { true: "#fee75c" }
                        })
                    ) : null,

                    // ── Run button ──
                    h(TouchableOpacity, {
                        style: [S.btn, { backgroundColor: running ? bgTer : (mode === "add" ? brand : danger), marginTop: 12 }],
                        onPress: running ? undefined : handleRun,
                        disabled: running
                    },
                        running
                            ? h(ActivityIndicator, { color: "#fff" })
                            : h(Text, { style: [S.btnTxt, { color: "#fff" }] },
                                mode === "add" ? "Apply Reactions" : "Remove Reactions")
                    )
                )
            )
        );
    }

    // ─────────────────────────────────────────────────────────────
    //  UserCard  (existing, slightly enhanced)
    // ─────────────────────────────────────────────────────────────
    function UserCard({ userId, onToggle, onDelete, onEdit, onReactExisting }) {
        const cfg   = storage.users[userId];
        const brand = c("BRAND_NEW", "#5865f2");
        const danger= c("STATUS_DANGER", "#ed4245");
        return h(View, { style: [S.card, { backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31") }] },
            h(View, { style: S.row },
                h(View, { style: { flex: 1 } },
                    h(Text, { style: [S.label, { color: c("TEXT_NORMAL", "#fff") }] }, cfg.label || userId),
                    h(Text, { style: [S.uid, { color: c("TEXT_MUTED", "#aaa") }] }, userId)
                ),
                h(Switch, { value: cfg.enabled, onValueChange: (v) => onToggle(userId, v), trackColor: { true: brand } }),
                h(TouchableOpacity, {
                    style: [S.smBtn, { backgroundColor: danger }],
                    onPress: () => onDelete(userId)
                }, h(Text, { style: [S.smTxt, { color: "#fff" }] }, "✕"))
            ),
            h(View, { style: S.emojiRow },
                cfg.emojis?.length > 0
                    ? cfg.emojis.map((e, i) => h(EmojiChip, { key: i, reactionStr: e }))
                    : h(Text, { style: [S.hint, { color: c("TEXT_MUTED", "#aaa") }] }, "No emojis — tap Edit Emojis")
            ),
            h(View, { style: [S.row, { marginTop: 10, flexWrap: "nowrap" }] },
                h(TouchableOpacity, {
                    style: [S.smBtn, { backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22"), flex: 1, alignItems: "center" }],
                    onPress: () => onEdit(userId)
                }, h(Text, { style: [S.smTxt, { color: c("TEXT_NORMAL", "#fff") }] }, "✏️  Edit Emojis")),
                h(TouchableOpacity, {
                    style: [S.smBtn, { backgroundColor: brand, marginLeft: 8, flex: 1, alignItems: "center" }],
                    onPress: () => onReactExisting(userId)
                }, h(Text, { style: [S.smTxt, { color: "#fff" }] }, "⚡ React Existing"))
            )
        );
    }

    // ─────────────────────────────────────────────────────────────
    //  EmojiEditor  (unchanged from original)
    // ─────────────────────────────────────────────────────────────
    function EmojiEditor({ userId, onDone }) {
        const cfg = storage.users[userId];
        const [emojis,      setEmojis]      = useState(cfg?.emojis || []);
        const [tab,         setTab]         = useState("server");
        const [unicodeInput,setUnicodeInput]= useState("");
        const [guildId,     setGuildId]     = useState(SelectedGuildStore.getGuildId() || "");
        const [serverEmojis,setServerEmojis]= useState([]);
        const [searchQuery, setSearchQuery] = useState("");

        useEffect(() => {
            if (guildId) setServerEmojis(EmojiStore.getGuildEmoji(guildId) || []);
        }, [guildId]);

        const guilds = useMemo(() => GuildStore.getGuilds ? Object.values(GuildStore.getGuilds()) : [], []);
        const searchResults = useMemo(() => {
            const q = searchQuery.trim().toLowerCase();
            if (!q) return [];
            const out = [];
            for (const guild of guilds) {
                for (const e of (EmojiStore.getGuildEmoji(guild.id) || [])) {
                    if (e.name.toLowerCase().includes(q)) out.push({ emoji: e, guild });
                }
            }
            return out.slice(0, 80);
        }, [searchQuery, guilds]);

        function addEmoji(rs)    { if (emojis.includes(rs)) return; const n=[...emojis,rs]; setEmojis(n); storage.users[userId].emojis=n; }
        function removeEmoji(rs) { const n=emojis.filter(e=>e!==rs); setEmojis(n); storage.users[userId].emojis=n; }
        function addUnicode() {
            const list = unicodeInput.trim().split(/[\s,]+/).map(p=>normalizeEmoji(p.trim())).filter(Boolean);
            let next = [...emojis];
            list.forEach(e => { if (!next.includes(e)) next.push(e); });
            setEmojis(next); storage.users[userId].emojis = next; setUnicodeInput("");
        }

        const brand    = c("BRAND_NEW", "#5865f2");
        const bgPri    = { backgroundColor: c("BACKGROUND_PRIMARY", "#313338") };
        const bgSec    = { backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31") };
        const textNorm = { color: c("TEXT_NORMAL", "#fff") };
        const textMuted= { color: c("TEXT_MUTED", "#aaa") };
        const inputStyle = [S.input, textNorm, bgSec, { borderColor: c("BACKGROUND_TERTIARY", "#1e1f22") }];

        function TabBtn({ id, label }) {
            const active = tab === id;
            return h(TouchableOpacity, {
                style: [S.tab, { backgroundColor: active ? brand : c("BACKGROUND_TERTIARY", "#1e1f22") }],
                onPress: () => setTab(id)
            }, h(Text, { style: [S.tabTxt, { color: active ? "#fff" : c("TEXT_NORMAL","#fff") }] }, label));
        }
        function EmojiGrid({ items, getReactionStr, getLabel, getGuildName }) {
            return h(View, { style: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 } },
                items.map((item) => {
                    const rs       = getReactionStr(item);
                    const selected = emojis.includes(rs);
                    return h(TouchableOpacity, {
                        key: item.emoji ? item.emoji.id : item.id,
                        style: [S.emojiPickerItem, { backgroundColor: selected ? brand : c("BACKGROUND_SECONDARY","#2b2d31") }],
                        onPress: () => selected ? removeEmoji(rs) : addEmoji(rs)
                    },
                        h(Image, { source: { uri: "https://cdn.discordapp.com/emojis/" + (item.emoji ? item.emoji.id : item.id) + ".webp?size=64" }, style: S.emojiPickerImg }),
                        h(Text, { style: [S.emojiPickerTxt, textMuted], numberOfLines: 1 }, getLabel(item)),
                        getGuildName ? h(Text, { style: [{ fontSize:9, marginTop:2, textAlign:"center", opacity:0.6 }, textMuted], numberOfLines:1 }, getGuildName(item)) : null
                    );
                })
            );
        }

        return h(ScrollView, { style: [S.container, bgPri], contentContainerStyle: { paddingBottom: 80 }, keyboardShouldPersistTaps: "handled" },
            h(Text, { style: [S.sectionTitle, textNorm] }, "Emojis for " + (cfg?.label || userId)),
            h(View, { style: [S.emojiRow, { marginBottom: 4 }] },
                emojis.length === 0
                    ? h(Text, { style: [S.hint, textMuted] }, "None added yet")
                    : emojis.map((e, i) => h(EmojiChip, { key: i, reactionStr: e, onRemove: () => removeEmoji(e) }))
            ),
            h(View, { style: [S.divider, { backgroundColor: c("TEXT_NORMAL","#fff") }] }),
            h(View, { style: S.tabRow },
                h(TabBtn, { id: "server", label: "🎮  Server" }),
                h(TabBtn, { id: "search", label: "🔍  Search" }),
                h(TabBtn, { id: "unicode", label: "✨  Unicode" })
            ),
            tab === "server" ? h(View, null,
                h(Text, { style: [S.hint, textMuted] }, "Pick a server:"),
                h(ScrollView, { horizontal: true, showsHorizontalScrollIndicator: false },
                    h(View, { style: { flexDirection: "row", paddingBottom: 10 } },
                        guilds.slice(0, 100).map(g => h(TouchableOpacity, {
                            key: g.id,
                            style: [S.guildPill, { backgroundColor: g.id === guildId ? brand : c("BACKGROUND_TERTIARY","#1e1f22") }],
                            onPress: () => setGuildId(g.id)
                        },
                            h(GuildIconView, { guild: g, size: 20 }),
                            h(Text, { style: { fontSize:12, fontWeight:"600", color: g.id===guildId ? "#fff" : c("TEXT_NORMAL","#fff") } }, g.name.slice(0,16))
                        ))
                    )
                ),
                serverEmojis.length === 0
                    ? h(Text, { style: [S.empty, textMuted] }, guildId ? "No custom emojis in this server" : "Select a server above")
                    : h(EmojiGrid, { items: serverEmojis, getReactionStr: e => emojiToReactionString(e), getLabel: e => e.name.slice(0,10), getGuildName: null })
            ) : null,
            tab === "search" ? h(View, null,
                h(TextInput, {
                    style: inputStyle, value: searchQuery, onChangeText: setSearchQuery,
                    placeholder: "Search by name e.g. blue_thumbs_up",
                    placeholderTextColor: c("TEXT_MUTED","#aaa"), autoCapitalize: "none", autoCorrect: false, clearButtonMode: "while-editing"
                }),
                searchQuery.trim().length === 0
                    ? h(Text, { style: [S.empty, textMuted] }, "Start typing to search across all servers")
                    : searchResults.length === 0
                        ? h(Text, { style: [S.empty, textMuted] }, "No emojis found for \"" + searchQuery + "\"")
                        : h(View, null,
                            h(Text, { style: [S.hint, textMuted] }, searchResults.length + " result" + (searchResults.length !== 1 ? "s" : "")),
                            h(EmojiGrid, { items: searchResults, getReactionStr: i => emojiToReactionString(i.emoji), getLabel: i => i.emoji.name.slice(0,10), getGuildName: i => i.guild.name.slice(0,10) })
                          )
            ) : null,
            tab === "unicode" ? h(View, null,
                h(Text, { style: [S.hint, textMuted] }, "Paste emoji separated by spaces or commas. iOS variation selectors (️) are stripped automatically."),
                h(TextInput, {
                    style: inputStyle, value: unicodeInput, onChangeText: setUnicodeInput,
                    placeholder: "👍 🔥 😢", placeholderTextColor: c("TEXT_MUTED","#aaa"), multiline: true
                }),
                h(TouchableOpacity, {
                    style: [S.btn, { backgroundColor: unicodeInput.trim() ? brand : c("BACKGROUND_TERTIARY","#1e1f22") }],
                    onPress: addUnicode
                }, h(Text, { style: [S.btnTxt, { color: "#fff" }] }, "Add"))
            ) : null,
            h(TouchableOpacity, {
                style: [S.btn, { backgroundColor: c("BACKGROUND_SECONDARY","#2b2d31"), marginTop: 24 }],
                onPress: onDone
            }, h(Text, { style: [S.btnTxt, { color: c("TEXT_NORMAL","#fff") }] }, "← Back"))
        );
    }

    // ─────────────────────────────────────────────────────────────
    //  Main Settings page  (enhanced with One-Time section + info cards)
    // ─────────────────────────────────────────────────────────────
    function Settings() {
        const [tick,        setTick]       = useState(0);
        const [newId,       setNewId]      = useState("");
        const [newLabel,    setNewLabel]   = useState("");
        const [editTarget,  setEditTarget] = useState(null);
        const [modalMode,   setModalMode]  = useState(null); // "add" | "remove" | null
        const refresh = () => setTick(n => n + 1);

        // Sub-screen: emoji editor
        if (editTarget && storage.users?.[editTarget]) {
            return h(EmojiEditor, { userId: editTarget, onDone: () => { setEditTarget(null); refresh(); } });
        }

        const nitro      = hasNitro();
        const userKeys   = Object.keys(storage.users || {});
        const brand      = c("BRAND_NEW", "#5865f2");
        const danger     = c("STATUS_DANGER", "#ed4245");
        const bgPri      = c("BACKGROUND_PRIMARY", "#313338");
        const bgSec      = c("BACKGROUND_SECONDARY", "#2b2d31");
        const bgTer      = c("BACKGROUND_TERTIARY", "#1e1f22");
        const textNorm   = c("TEXT_NORMAL", "#fff");
        const textMuted  = c("TEXT_MUTED", "#aaa");
        const inputStyle = [S.input, { color: textNorm, backgroundColor: bgSec, borderColor: bgTer }];

        function handleAdd() {
            const uid = newId.trim();
            if (!uid) return;
            if (!storage.users) storage.users = {};
            storage.users[uid] = { label: newLabel.trim() || uid, emojis: [], enabled: true };
            setNewId(""); setNewLabel(""); setEditTarget(uid);
        }
        function handleDelete(uid) {
            Alert.alert("Remove User", "Remove " + (storage.users[uid]?.label || uid) + "?", [
                { text: "Cancel", style: "cancel" },
                { text: "Remove", style: "destructive", onPress: () => { delete storage.users[uid]; refresh(); } }
            ]);
        }
        function handleReactExisting(uid) {
            const cfg = storage.users[uid];
            if (!cfg?.enabled) { Alert.alert("User Disabled", "Enable this user first."); return; }
            reactToExisting(uid);
            Alert.alert("Done", "Reacting to recent messages from " + (cfg.label || uid) + " in current channel.");
        }

        return h(ScrollView, {
            style: { flex: 1, backgroundColor: bgPri },
            contentContainerStyle: { padding: 16, paddingBottom: 80 },
            keyboardShouldPersistTaps: "handled"
        },
            // ── Status card ──
            h(View, { style: [S.card, { backgroundColor: bgSec, marginTop: 4 }] },
                h(View, { style: S.row },
                    h(Text, { style: { fontSize: 22, marginRight: 10 } }, "⚡"),
                    h(View, { style: { flex: 1 } },
                        h(Text, { style: { fontSize: 16, fontWeight: "800", color: textNorm } }, "AutoReact"),
                        h(Text, { style: { fontSize: 12, color: textMuted, marginTop: 2 } },
                            userKeys.filter(k => storage.users[k]?.enabled).length + " active rule(s)  ·  " +
                            userKeys.length + " total")
                    ),
                    // Nitro badge
                    h(View, { style: [S.badge, { backgroundColor: nitro ? "#fee75c30" : bgTer }] },
                        h(Text, { style: [S.badgeTxt, { color: nitro ? "#fee75c" : textMuted }] },
                            nitro ? "✦ NITRO" : "NO NITRO"))
                )
            ),

            // ── One-Time Reaction ──
            h(View, { style: S.sectionRow },
                h(Text, { style: [S.sectionTitle, { color: textNorm, marginTop: 0, marginBottom: 0 }] }, "One-Time Reaction"),
                h(View, { style: [S.badge, { backgroundColor: "#57f28720" }] },
                    h(Text, { style: [S.badgeTxt, { color: "#57f287" }] }, "No Storage"))
            ),
            h(Text, { style: [S.hint, { color: textMuted }] },
                "Fetch & react to a user's past messages once. Nothing is saved to config."),
            h(View, { style: { flexDirection: "row", gap: 8 } },
                h(TouchableOpacity, {
                    style: [S.btn, { flex: 1, backgroundColor: brand, marginTop: 0 }],
                    onPress: () => setModalMode("add")
                }, h(Text, { style: [S.btnTxt, { color: "#fff" }] }, "⚡  /add")),
                h(TouchableOpacity, {
                    style: [S.btn, { flex: 1, backgroundColor: danger, marginTop: 0 }],
                    onPress: () => setModalMode("remove")
                }, h(Text, { style: [S.btnTxt, { color: "#fff" }] }, "🗑️  /remove"))
            ),

            h(View, { style: [S.divider, { backgroundColor: textNorm, marginTop: 20 }] }),

            // ── Add persistent user ──
            h(Text, { style: [S.sectionTitle, { color: textNorm }] }, "Add Auto-React User"),
            h(Text, { style: [S.hint, { color: textMuted }] }, "Display name (optional)"),
            h(TextInput, { style: inputStyle, value: newLabel, onChangeText: setNewLabel, placeholder: "John Doe", placeholderTextColor: textMuted }),
            h(Text, { style: [S.hint, { color: textMuted }] }, "User ID (tap avatar → Copy ID)"),
            h(TextInput, { style: inputStyle, value: newId, onChangeText: setNewId, placeholder: "123456789012345678", placeholderTextColor: textMuted, keyboardType: "numeric" }),
            h(TouchableOpacity, {
                style: [S.btn, { backgroundColor: newId.trim() ? brand : bgTer }],
                onPress: handleAdd
            }, h(Text, { style: [S.btnTxt, { color: "#fff" }] }, "Add User & Pick Emojis")),

            // ── Watched users list ──
            h(View, { style: S.sectionRow },
                h(Text, { style: [S.sectionTitle, { color: textNorm, marginTop: 0, marginBottom: 0 }] }, "Watched Users"),
                h(View, { style: [S.badge, { backgroundColor: brand + "33" }] },
                    h(Text, { style: [S.badgeTxt, { color: brand }] }, String(userKeys.length)))
            ),
            userKeys.length === 0
                ? h(Text, { style: [S.empty, { color: textMuted }] }, "No users added yet")
                : userKeys.map(uid => h(UserCard, {
                    key: uid + tick,
                    userId: uid,
                    onToggle:        (u, v) => { storage.users[u].enabled = v; refresh(); },
                    onDelete:        handleDelete,
                    onEdit:          setEditTarget,
                    onReactExisting: handleReactExisting
                })),

            // ── Quick React modal (bottom sheet) ──
            h(QuickReactModal, {
                visible: modalMode !== null,
                mode:    modalMode || "add",
                onClose: () => setModalMode(null)
            })
        );
    }

    // ─────────────────────────────────────────────────────────────
    //  Plugin lifecycle
    // ─────────────────────────────────────────────────────────────
    var index = {
        onLoad() {
            if (!storage.users) storage.users = {};
            interceptFn = (payload) => {
                if (payload.type !== "MESSAGE_CREATE" || payload.optimistic) return null;
                const authorId = payload.message?.author?.id;
                if (!authorId) return null;
                const cfg = storage.users?.[authorId];
                if (cfg?.enabled && cfg.emojis?.length > 0) {
                    reactToMessage(payload.channelId, payload.message.id, cfg.emojis);
                }
                return null;
            };
            FD._interceptors.push(interceptFn);
        },
        onUnload() {
            if (interceptFn) {
                FD._interceptors = FD._interceptors.filter(f => f !== interceptFn);
                interceptFn = null;
            }
        },
        settings: Settings
    };

    return index;
})();
