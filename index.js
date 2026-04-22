(function () {
    'use strict';

    const vd = window.vendetta;
    const { findByProps, findByStoreName } = vd.metro;
    const { createStorage, wrapSync, createMMKVBackend } = vd.storage;
    const React = findByProps("createElement", "useState");
    const RN = findByProps("View", "Text", "StyleSheet");
    const { createElement: h, useState, useEffect, useMemo } = React;
    const { View, Text, TextInput, ScrollView, Switch, StyleSheet, Alert, TouchableOpacity, Image } = RN;

    const HTTP         = findByProps("put", "del", "patch", "post", "get", "getAPIBaseURL");
    const TokenStore   = findByStoreName("AuthenticationStore");
    const FD           = findByProps("_interceptors");
    const EmojiStore   = findByStoreName("EmojiStore");
    const GuildStore   = findByStoreName("GuildStore");
    const SelGuildStore   = findByStoreName("SelectedGuildStore");
    const MessageStore    = findByStoreName("MessageStore");
    const SelChannelStore = findByStoreName("SelectedChannelStore");
    const UserStore       = findByStoreName("UserStore");
    const tokens = findByProps("unsafe_rawColors", "colors");

    const storage = wrapSync(createStorage(createMMKVBackend("AutoReact")));

    // In-memory burst sessions: { [userId]: { emojis: string[], remaining: number } }
    const burstSessions = {};
    let interceptFn = null;
    const unregCmds = [];

    // ─── Colour helper ──────────────────────────────────────────────────────
    function c(key, fallback) {
        return tokens?.colors?.[key] || fallback;
    }

    // ─── Emoji helpers ──────────────────────────────────────────────────────
    function normalizeEmoji(str) { return str.replace(/\uFE0F/g, ""); }

    function emojiToReactionString(e) {
        if (!e.id) return normalizeEmoji(e.name);
        return (e.animated ? "a:" : "") + e.name + ":" + e.id;
    }

    function getCustomEmojiId(rs) {
        const m = rs.match(/:(\d+)$/);
        return m ? m[1] : null;
    }

    function getCustomEmojiName(rs) {
        const parts = rs.split(":");
        if (parts.length === 2) return parts[0];
        if (parts.length === 3 && parts[0] === "a") return parts[1];
        return null;
    }

    // Parse <:name:id> / <a:name:id> or unicode emoji string from a slash-command arg
    function parseEmojiArg(str) {
        if (!str) return null;
        const custom = String(str).match(/^<(a?):([^:]+):(\d+)>$/);
        if (custom) return (custom[1] ? "a:" : "") + custom[2] + ":" + custom[3];
        const norm = normalizeEmoji(String(str).trim());
        return norm || null;
    }

    // ─── Nitro / super-react ────────────────────────────────────────────────
    function hasNitro() {
        try { return (UserStore?.getCurrentUser?.()?.premium_type ?? 0) > 0; }
        catch { return false; }
    }

    function guildIconUrl(guild) {
        if (!guild?.icon) return null;
        return "https://cdn.discordapp.com/icons/" + guild.id + "/" + guild.icon + ".webp?size=32";
    }

    // ─── Core react ─────────────────────────────────────────────────────────
    function reactToMessage(channelId, msgId, emojis, superReact) {
        const token = TokenStore.getToken();
        const useSuperReact = !!(superReact && (storage.superReactions ?? false) && hasNitro());
        emojis.forEach(function (emoji, i) {
            setTimeout(function () {
                const encoded = encodeURIComponent(normalizeEmoji(emoji));
                const typeParam = useSuperReact ? "?type=1" : "";
                const url = "https://discord.com/api/v9/channels/" + channelId + "/messages/" + msgId + "/reactions/" + encoded + "/@me" + typeParam;
                HTTP.put({ url, headers: { Authorization: token } }).catch(function () {});
            }, i * 350);
        });
    }

    // React to the last N existing messages from userId in current channel (settings button)
    function reactToExisting(userId, count) {
        const cfg = storage.users?.[userId];
        if (!cfg?.enabled || !cfg.emojis?.length) return;
        const channelId = SelChannelStore.getChannelId();
        if (!channelId) return;
        const msgs = MessageStore.getMessages(channelId);
        const arr = msgs?._array || msgs?.toArray?.() || [];
        const userMsgs = arr.filter(m => m.author?.id === userId).slice(-(count ?? 20));
        userMsgs.forEach(function (msg, i) {
            setTimeout(function () { reactToMessage(channelId, msg.id, cfg.emojis, cfg.superReact); }, i * cfg.emojis.length * 400);
        });
    }

    // One-shot burst command: react to last N messages + watch for N more incoming
    function burstReact(userId, emojiStr, count) {
        const channelId = SelChannelStore.getChannelId();
        if (!channelId) return "❌ No active channel.";
        const msgs = MessageStore.getMessages(channelId);
        const arr = msgs?._array || msgs?.toArray?.() || [];
        const userMsgs = arr.filter(m => m.author?.id === userId).slice(-count);
        userMsgs.forEach(function (msg, i) {
            setTimeout(function () { reactToMessage(channelId, msg.id, [emojiStr]); }, i * 400);
        });
        const incoming = count - userMsgs.length;
        if (incoming > 0) burstSessions[userId] = { emojis: [emojiStr], remaining: incoming };
        const parts = [];
        if (userMsgs.length > 0) parts.push("Reacted to " + userMsgs.length + " existing message" + (userMsgs.length !== 1 ? "s" : "") + ".");
        if (incoming > 0) parts.push("Watching for " + incoming + " more incoming.");
        return "⚡ " + (parts.join(" ") || "Done.");
    }

    // ─── Slash commands ──────────────────────────────────────────────────────
    // ApplicationCommandOptionType: STRING=3, INTEGER=4, USER=6
    function registerCommands() {
        if (!vd.commands?.registerCommand) return;

        // /autoreact-add
        unregCmds.push(vd.commands.registerCommand({
            name: "autoreact-add",
            displayName: "autoreact-add",
            description: "One-shot: react to a user\u2019s recent + next messages",
            displayDescription: "One-shot: react to a user\u2019s recent + next messages",
            options: [
                {
                    name: "user",
                    displayName: "user",
                    description: "Target user",
                    displayDescription: "Target user",
                    type: 6,   // USER
                    required: true
                },
                {
                    name: "reaction",
                    displayName: "reaction",
                    description: "Emoji to react with (unicode or custom <:name:id>)",
                    displayDescription: "Emoji to react with",
                    type: 3,   // STRING
                    required: true
                },
                {
                    name: "message_count",
                    displayName: "message_count",
                    description: "Number of messages (default 5, max 50)",
                    displayDescription: "Number of messages",
                    type: 4,   // INTEGER
                    required: false
                }
            ],
            execute(args, ctx) {
                const userId     = String(args.find(a => a.name === "user")?.value ?? "");
                const reactionRaw = args.find(a => a.name === "reaction")?.value;
                const countRaw    = args.find(a => a.name === "message_count")?.value;

                if (!userId) return { content: "❌ Invalid user." };
                const emojiStr = parseEmojiArg(reactionRaw);
                if (!emojiStr) return { content: "❌ Invalid emoji. Use a unicode emoji or \u003c:name:id\u003e." };
                const count = Math.max(1, Math.min(50, parseInt(countRaw) || 5));

                const result = burstReact(userId, emojiStr, count);
                return { content: result };
            }
        }));

        // /autoreact-remove
        unregCmds.push(vd.commands.registerCommand({
            name: "autoreact-remove",
            displayName: "autoreact-remove",
            description: "Remove a user from AutoReact (or cancel burst session)",
            displayDescription: "Remove a user from AutoReact",
            options: [
                {
                    name: "user",
                    displayName: "user",
                    description: "Target user",
                    displayDescription: "Target user",
                    type: 6,   // USER
                    required: true
                }
            ],
            execute(args) {
                const userId = String(args.find(a => a.name === "user")?.value ?? "");
                if (!userId) return { content: "❌ Invalid user." };

                if (burstSessions[userId]) {
                    const rem = burstSessions[userId].remaining;
                    delete burstSessions[userId];
                    return { content: "\u2705 Cancelled burst session for \u003c@" + userId + "\u003e (" + rem + " reactions left)." };
                }
                if (storage.users?.[userId]) {
                    const label = storage.users[userId].label || userId;
                    delete storage.users[userId];
                    return { content: "\u2705 Removed **" + label + "** from watched users." };
                }
                return { content: "\u26A0\uFE0F \u003c@" + userId + "\u003e is not in your watched list or burst sessions." };
            }
        }));
    }

    // ─── Styles ─────────────────────────────────────────────────────────────
    const S = StyleSheet.create({
        container: { flex: 1 },
        scroll: { paddingHorizontal: 16 },

        // ── Hero / stats
        heroRow:  { flexDirection: "row", alignItems: "center", paddingTop: 12, paddingBottom: 4 },
        heroTitle: { fontSize: 26, fontWeight: "800" },
        heroSub:   { fontSize: 12, opacity: 0.45, marginTop: 2 },
        statsRow:  { flexDirection: "row", gap: 8, marginVertical: 12 },
        statCard:  { flex: 1, borderRadius: 16, padding: 14, alignItems: "center" },
        statNum:   { fontSize: 24, fontWeight: "800" },
        statLbl:   { fontSize: 10, opacity: 0.5, fontWeight: "700", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 },

        // ── Section labels
        sectionLbl: {
            fontSize: 11, fontWeight: "700", textTransform: "uppercase",
            letterSpacing: 0.9, opacity: 0.5, marginBottom: 6, marginTop: 18
        },

        // ── Cards
        card: {
            borderRadius: 18, marginBottom: 10, padding: 16,
            shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.15, shadowRadius: 6, elevation: 3
        },
        addCard: {
            borderRadius: 20, marginBottom: 4, padding: 18,
            shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.18, shadowRadius: 8, elevation: 4
        },

        // ── Typography
        displayName: { fontSize: 16, fontWeight: "700", flex: 1 },
        uid:         { fontSize: 11, opacity: 0.38, marginTop: 1 },
        hint:        { fontSize: 12, opacity: 0.45, marginBottom: 8, lineHeight: 17 },
        emptyTxt:    { textAlign: "center", opacity: 0.3, fontSize: 14, lineHeight: 21 },

        // ── Row
        row: { flexDirection: "row", alignItems: "center" },

        // ── Input
        input: {
            borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
            fontSize: 14, marginBottom: 10, borderWidth: 1.5
        },

        // ── Buttons
        primaryBtn: {
            borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 4,
            shadowColor: "#5865f2", shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.3, shadowRadius: 6, elevation: 4
        },
        primaryBtnTxt: { fontSize: 15, fontWeight: "700", color: "#fff" },
        iconBtn: { borderRadius: 10, width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: 6 },
        splitBtn: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: "center" },
        splitBtnTxt: { fontSize: 13, fontWeight: "600" },

        // ── Emoji
        emojiRow:    { flexDirection: "row", flexWrap: "wrap", gap: 6 },
        chip:        { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 4 },
        chipTxt:     { fontSize: 11, fontWeight: "600" },

        // ── Emoji picker
        tabBar:    { flexDirection: "row", gap: 6, marginBottom: 14 },
        tab:       { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flex: 1, alignItems: "center" },
        tabTxt:    { fontSize: 13, fontWeight: "700" },
        emojiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
        emojiItem: { width: 66, height: 74, alignItems: "center", justifyContent: "center", borderRadius: 12, padding: 4 },
        emojiImg:  { width: 40, height: 40, borderRadius: 8 },
        emojiName: { fontSize: 9, marginTop: 3, textAlign: "center" },

        // ── Guild pills
        guildRow:    { flexDirection: "row", paddingBottom: 10 },
        guildPill:   { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginRight: 6, flexDirection: "row", alignItems: "center", gap: 6 },
        guildPillTxt: { fontSize: 12, fontWeight: "600" },

        // ── Badge
        badge:    { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4 },
        badgeTxt: { fontSize: 11, fontWeight: "700" },

        // ── Commands hint box
        cmdHint:     { borderRadius: 14, padding: 14, marginVertical: 4 },
        cmdHintTitle: { fontSize: 12, fontWeight: "700", marginBottom: 5 },
        cmdHintLine:  { fontSize: 11, lineHeight: 18 },
    });

    // ─── Components ─────────────────────────────────────────────────────────

    function GuildIcon({ guild, size }) {
        size = size || 22;
        const r = size / 3;
        const iconUrl = guildIconUrl(guild);
        if (iconUrl) return h(Image, { source: { uri: iconUrl }, style: { width: size, height: size, borderRadius: r } });
        const pal = ["#5865f2","#57f287","#fee75c","#eb459e","#ed4245","#faa61a"];
        const bg = pal[parseInt(guild.id.slice(-2), 10) % pal.length];
        return h(View, { style: { width: size, height: size, borderRadius: r, backgroundColor: bg, alignItems: "center", justifyContent: "center" } },
            h(Text, { style: { fontSize: size * 0.5, fontWeight: "800", color: "#fff" } }, guild.name.charAt(0).toUpperCase()));
    }

    function EmojiChip({ reactionStr, onRemove }) {
        const id   = getCustomEmojiId(reactionStr);
        const name = getCustomEmojiName(reactionStr);
        return h(View, { style: [S.chip, { backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22") }] },
            id
                ? h(Image, { source: { uri: "https://cdn.discordapp.com/emojis/" + id + ".webp?size=32" }, style: { width: 20, height: 20, borderRadius: 4 } })
                : h(Text, { style: { fontSize: 16 } }, reactionStr),
            name ? h(Text, { style: [S.chipTxt, { color: c("TEXT_MUTED", "#aaa") }] }, name) : null,
            onRemove
                ? h(TouchableOpacity, { onPress: onRemove, hitSlop: { top: 8, bottom: 8, left: 8, right: 8 } },
                    h(Text, { style: { fontSize: 15, color: c("TEXT_MUTED", "#aaa"), opacity: 0.7, marginLeft: 2 } }, "\u00D7"))
                : null
        );
    }

    function StatCard({ value, label }) {
        return h(View, { style: [S.statCard, { backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31") }] },
            h(Text, { style: [S.statNum, { color: c("BRAND_NEW", "#5865f2") }] }, String(value)),
            h(Text, { style: [S.statLbl, { color: c("TEXT_MUTED", "#aaa") }] }, label)
        );
    }

    function UserCard({ userId, onToggle, onDelete, onEdit, onReactExisting, tick }) {
        const cfg   = storage.users[userId];
        const brand = c("BRAND_NEW", "#5865f2");
        const burst = burstSessions[userId];

        return h(View, { style: [S.card, { backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31") }] },

            // ── Header row
            h(View, { style: [S.row, { marginBottom: 6 }] },
                h(View, { style: { flex: 1 } },
                    h(View, { style: [S.row, { gap: 6 }] },
                        h(Text, { style: [S.displayName, { color: c("TEXT_NORMAL", "#fff") }] }, cfg.label || userId),
                        burst
                            ? h(View, { style: { backgroundColor: "#fee75c22", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 } },
                                h(Text, { style: { fontSize: 10, fontWeight: "700", color: "#fee75c" } }, "\u26A1 " + burst.remaining))
                            : null
                    ),
                    h(Text, { style: [S.uid, { color: c("TEXT_MUTED", "#aaa") }] }, userId)
                ),
                h(Switch, {
                    value: cfg.enabled,
                    onValueChange: v => onToggle(userId, v),
                    trackColor: { true: brand }
                }),
                h(TouchableOpacity, {
                    style: [S.iconBtn, { backgroundColor: "#ed424520" }],
                    onPress: () => onDelete(userId)
                }, h(Text, { style: { fontSize: 16 } }, "\uD83D\uDDD1"))
            ),

            // ── Emoji chips
            h(View, { style: [S.emojiRow, { marginBottom: cfg.emojis?.length > 0 ? 0 : 0 }] },
                cfg.emojis?.length > 0
                    ? cfg.emojis.map((e, i) => h(EmojiChip, { key: i, reactionStr: e }))
                    : h(Text, { style: [S.hint, { color: c("TEXT_MUTED", "#aaa"), marginBottom: 0 }] }, "No emojis \u2014 tap Edit Emojis")
            ),

            // ── Super react per-user toggle (only when global Nitro super is enabled)
            storage.superReactions && hasNitro()
                ? h(View, { style: [S.row, { marginTop: 10, gap: 8 }] },
                    h(View, { style: [S.badge, { backgroundColor: "#5865f218" }] },
                        h(Text, { style: [S.badgeTxt, { color: c("BRAND_NEW", "#5865f2") }] }, "\uD83D\uDC8E Super React")
                    ),
                    h(View, { style: { flex: 1 } }),
                    h(Switch, {
                        value: cfg.superReact ?? false,
                        onValueChange: v => { storage.users[userId].superReact = v; },
                        trackColor: { true: brand }
                    })
                )
                : null,

            // ── Action buttons
            h(View, { style: [S.row, { marginTop: 12, gap: 8 }] },
                h(TouchableOpacity, {
                    style: [S.splitBtn, { backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22") }],
                    onPress: () => onEdit(userId)
                }, h(Text, { style: [S.splitBtnTxt, { color: c("TEXT_NORMAL", "#fff") }] }, "\u270F\uFE0F  Edit Emojis")),
                h(TouchableOpacity, {
                    style: [S.splitBtn, { backgroundColor: brand }],
                    onPress: () => onReactExisting(userId)
                }, h(Text, { style: [S.splitBtnTxt, { color: "#fff" }] }, "\u26A1  React Existing"))
            )
        );
    }

    // ─── Emoji editor ────────────────────────────────────────────────────────
    function EmojiEditor({ userId, onDone }) {
        const cfg = storage.users[userId];
        const [emojis, setEmojis]       = useState(cfg?.emojis || []);
        const [tab, setTab]             = useState("server");
        const [unicodeInput, setUnicode] = useState("");
        const [guildId, setGuildId]      = useState(SelGuildStore.getGuildId() || "");
        const [serverEmojis, setSvr]     = useState([]);
        const [searchQuery, setSearch]   = useState("");

        useEffect(function () {
            if (guildId) setSvr(EmojiStore.getGuildEmoji(guildId) || []);
        }, [guildId]);

        const guilds = useMemo(function () {
            return GuildStore.getGuilds ? Object.values(GuildStore.getGuilds()) : [];
        }, []);

        const searchResults = useMemo(function () {
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

        function addEmoji(rs) {
            if (emojis.includes(rs)) return;
            const next = [...emojis, rs];
            setEmojis(next);
            storage.users[userId].emojis = next;
        }
        function removeEmoji(rs) {
            const next = emojis.filter(e => e !== rs);
            setEmojis(next);
            storage.users[userId].emojis = next;
        }
        function addUnicode() {
            const list = unicodeInput.trim().split(/[\s,]+/).map(p => normalizeEmoji(p.trim())).filter(Boolean);
            const next = [...emojis];
            list.forEach(e => { if (!next.includes(e)) next.push(e); });
            setEmojis(next);
            storage.users[userId].emojis = next;
            setUnicode("");
        }

        const brand    = c("BRAND_NEW", "#5865f2");
        const bgPri    = c("BACKGROUND_PRIMARY", "#313338");
        const bgSec    = c("BACKGROUND_SECONDARY", "#2b2d31");
        const bgTer    = c("BACKGROUND_TERTIARY", "#1e1f22");
        const textNorm = c("TEXT_NORMAL", "#fff");
        const textMuted = c("TEXT_MUTED", "#aaa");

        function Tab({ id, icon, label }) {
            const active = tab === id;
            return h(TouchableOpacity, {
                style: [S.tab, { backgroundColor: active ? brand : bgTer }],
                onPress: () => setTab(id)
            }, h(Text, { style: [S.tabTxt, { color: active ? "#fff" : textNorm }] }, icon + "  " + label));
        }

        function EmojiGrid({ items, getRS, getLbl, getGuild }) {
            return h(View, { style: S.emojiGrid },
                items.map(function (item) {
                    const rs = getRS(item);
                    const selected = emojis.includes(rs);
                    const emojiId = item.emoji ? item.emoji.id : item.id;
                    return h(TouchableOpacity, {
                        key: emojiId,
                        style: [
                            S.emojiItem,
                            {
                                backgroundColor: selected ? brand + "33" : bgSec,
                                borderWidth: selected ? 1.5 : 0,
                                borderColor: brand
                            }
                        ],
                        onPress: () => selected ? removeEmoji(rs) : addEmoji(rs)
                    },
                        h(Image, {
                            source: { uri: "https://cdn.discordapp.com/emojis/" + emojiId + ".webp?size=64" },
                            style: S.emojiImg
                        }),
                        h(Text, { style: [S.emojiName, { color: textMuted }], numberOfLines: 1 }, getLbl(item)),
                        getGuild
                            ? h(Text, { style: [S.emojiName, { color: textMuted, opacity: 0.55 }], numberOfLines: 1 }, getGuild(item))
                            : null
                    );
                })
            );
        }

        return h(ScrollView, {
            style: [S.container, { backgroundColor: bgPri }],
            contentContainerStyle: { padding: 16, paddingBottom: 80 },
            keyboardShouldPersistTaps: "handled"
        },
            // Back + title
            h(View, { style: [S.row, { marginBottom: 18, gap: 10 }] },
                h(TouchableOpacity, {
                    onPress: onDone,
                    style: { padding: 8, borderRadius: 12, backgroundColor: bgSec }
                }, h(Text, { style: { fontSize: 16, color: textNorm } }, "\u2190")),
                h(View, null,
                    h(Text, { style: { fontSize: 19, fontWeight: "800", color: textNorm } }, "Edit Emojis"),
                    h(Text, { style: [S.uid, { color: textMuted }] }, cfg?.label || userId)
                )
            ),

            // Selected emojis
            emojis.length === 0
                ? h(View, { style: { backgroundColor: bgSec, borderRadius: 14, padding: 16, marginBottom: 16, alignItems: "center" } },
                    h(Text, { style: { color: textMuted, fontSize: 13 } }, "No emojis selected yet"))
                : h(View, { style: { backgroundColor: bgSec, borderRadius: 14, padding: 14, marginBottom: 16 } },
                    h(Text, { style: [S.sectionLbl, { color: textNorm, marginTop: 0 }] }, "Selected"),
                    h(View, { style: [S.emojiRow, { marginTop: 8 }] },
                        emojis.map((e, i) => h(EmojiChip, { key: i, reactionStr: e, onRemove: () => removeEmoji(e) }))
                    )
                ),

            // Tabs
            h(View, { style: S.tabBar },
                h(Tab, { id: "server",  icon: "\uD83C\uDFAE", label: "Server" }),
                h(Tab, { id: "search",  icon: "\uD83D\uDD0D", label: "Search" }),
                h(Tab, { id: "unicode", icon: "\u2728",       label: "Unicode" })
            ),

            // ── SERVER
            tab === "server" ? h(View, null,
                h(Text, { style: [S.hint, { color: textMuted }] }, "Select a server:"),
                h(ScrollView, { horizontal: true, showsHorizontalScrollIndicator: false },
                    h(View, { style: S.guildRow },
                        guilds.slice(0, 100).map(g =>
                            h(TouchableOpacity, {
                                key: g.id,
                                style: [S.guildPill, { backgroundColor: g.id === guildId ? brand : bgTer }],
                                onPress: () => setGuildId(g.id)
                            },
                                h(GuildIcon, { guild: g, size: 20 }),
                                h(Text, { style: [S.guildPillTxt, { color: g.id === guildId ? "#fff" : textNorm }] }, g.name.slice(0, 15))
                            )
                        )
                    )
                ),
                serverEmojis.length === 0
                    ? h(Text, { style: [S.emptyTxt, { color: textMuted, marginTop: 32 }] },
                        guildId ? "No custom emojis here.\nTry another server." : "Select a server above.")
                    : h(EmojiGrid, {
                        items: serverEmojis,
                        getRS: e => emojiToReactionString(e),
                        getLbl: e => e.name.slice(0, 10)
                    })
            ) : null,

            // ── SEARCH
            tab === "search" ? h(View, null,
                h(TextInput, {
                    style: [S.input, { color: textNorm, backgroundColor: bgSec, borderColor: bgTer }],
                    value: searchQuery,
                    onChangeText: setSearch,
                    placeholder: "Search emoji names\u2026",
                    placeholderTextColor: textMuted,
                    autoCapitalize: "none",
                    autoCorrect: false,
                    clearButtonMode: "while-editing"
                }),
                searchQuery.trim().length === 0
                    ? h(Text, { style: [S.emptyTxt, { color: textMuted, marginTop: 32 }] }, "Search across all your servers.")
                    : searchResults.length === 0
                        ? h(Text, { style: [S.emptyTxt, { color: textMuted, marginTop: 32 }] }, "No emojis found for \u201C" + searchQuery + "\u201D")
                        : h(View, null,
                            h(Text, { style: [S.hint, { color: textMuted }] }, searchResults.length + " result" + (searchResults.length !== 1 ? "s" : "")),
                            h(EmojiGrid, {
                                items: searchResults,
                                getRS: item => emojiToReactionString(item.emoji),
                                getLbl: item => item.emoji.name.slice(0, 10),
                                getGuild: item => item.guild.name.slice(0, 10)
                            })
                        )
            ) : null,

            // ── UNICODE
            tab === "unicode" ? h(View, null,
                h(Text, { style: [S.hint, { color: textMuted }] },
                    "Paste emoji separated by spaces or commas. iOS variation selectors (\uFE0F) are stripped automatically."),
                h(TextInput, {
                    style: [S.input, { color: textNorm, backgroundColor: bgSec, borderColor: bgTer, minHeight: 80 }],
                    value: unicodeInput,
                    onChangeText: setUnicode,
                    placeholder: "\uD83D\uDC4D \uD83D\uDD25 \uD83D\uDE2D",
                    placeholderTextColor: textMuted,
                    multiline: true
                }),
                h(TouchableOpacity, {
                    style: [S.primaryBtn, { backgroundColor: unicodeInput.trim() ? brand : bgTer }],
                    onPress: addUnicode
                }, h(Text, { style: S.primaryBtnTxt }, "Add Emojis"))
            ) : null
        );
    }

    // ─── Settings root ───────────────────────────────────────────────────────
    function Settings() {
        const [tick, setTick]           = useState(0);
        const refresh                   = () => setTick(n => n + 1);
        const [newId, setNewId]         = useState("");
        const [newLabel, setNewLabel]   = useState("");
        const [editTarget, setEdit]     = useState(null);
        const [superReact, setSuper]    = useState(storage.superReactions ?? false);

        if (editTarget && storage.users?.[editTarget]) {
            return h(EmojiEditor, { userId: editTarget, onDone: () => { setEdit(null); refresh(); } });
        }

        const userKeys     = Object.keys(storage.users || {});
        const enabledCount = userKeys.filter(k => storage.users[k].enabled).length;
        const totalEmojis  = userKeys.reduce((s, k) => s + (storage.users[k].emojis?.length || 0), 0);
        const burstCount   = Object.keys(burstSessions).length;

        const brand    = c("BRAND_NEW", "#5865f2");
        const bgPri    = c("BACKGROUND_PRIMARY", "#313338");
        const bgSec    = c("BACKGROUND_SECONDARY", "#2b2d31");
        const bgTer    = c("BACKGROUND_TERTIARY", "#1e1f22");
        const textNorm = c("TEXT_NORMAL", "#fff");
        const textMuted = c("TEXT_MUTED", "#aaa");
        const canAdd   = newId.trim().length > 0;

        function handleAdd() {
            const uid = newId.trim();
            if (!uid) return;
            if (!storage.users) storage.users = {};
            storage.users[uid] = { label: newLabel.trim() || uid, emojis: [], enabled: true };
            setNewId("");
            setNewLabel("");
            setEdit(uid);
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
            Alert.alert("\u26A1 AutoReact", "Reacting to recent messages from " + (cfg.label || uid) + ".");
        }

        return h(ScrollView, {
            style: [S.container, { backgroundColor: bgPri }],
            contentContainerStyle: { paddingHorizontal: 16, paddingBottom: 80 },
            keyboardShouldPersistTaps: "handled"
        },

            // ── Hero
            h(View, { style: S.heroRow },
                h(View, { style: { flex: 1 } },
                    h(Text, { style: [S.heroTitle, { color: textNorm }] }, "AutoReact"),
                    h(Text, { style: [S.heroSub, { color: textMuted }] }, "Auto-react to messages from selected users")
                ),
                // Nitro super-react global toggle
                hasNitro()
                    ? h(TouchableOpacity, {
                        style: [
                            S.badge,
                            {
                                backgroundColor: superReact ? brand + "33" : bgSec,
                                borderWidth: 1.5,
                                borderColor: superReact ? brand : bgTer
                            }
                        ],
                        onPress: function () {
                            const next = !superReact;
                            storage.superReactions = next;
                            setSuper(next);
                        }
                    },
                        h(Text, { style: [S.badgeTxt, { color: superReact ? brand : textMuted }] }, "\uD83D\uDC8E Super")
                    )
                    : null
            ),

            // ── Stats
            h(View, { style: S.statsRow },
                h(StatCard, { value: userKeys.length, label: "USERS"   }),
                h(StatCard, { value: enabledCount,    label: "ACTIVE"  }),
                h(StatCard, { value: totalEmojis,     label: "EMOJIS"  }),
                h(StatCard, { value: burstCount,      label: "BURSTS"  })
            ),

            // ── Slash command hint
            h(View, { style: [S.cmdHint, { backgroundColor: "#fee75c0e" }] },
                h(Text, { style: [S.cmdHintTitle, { color: "#fee75c" }] }, "\u26A1 Slash Commands"),
                h(Text, { style: [S.cmdHintLine, { color: textMuted }] },
                    "/autoreact-add user:@user reaction:\uD83D\uDD25 message_count:7\n" +
                    "/autoreact-remove user:@user"
                )
            ),

            // ── Add user section
            h(Text, { style: [S.sectionLbl, { color: textNorm }] }, "Add User"),
            h(View, { style: [S.addCard, { backgroundColor: bgSec }] },
                h(Text, { style: [S.hint, { color: textMuted, marginBottom: 4 }] }, "Display name (optional)"),
                h(TextInput, {
                    style: [S.input, { color: textNorm, backgroundColor: bgTer, borderColor: "transparent" }],
                    value: newLabel,
                    onChangeText: setNewLabel,
                    placeholder: "John Doe",
                    placeholderTextColor: textMuted
                }),
                h(Text, { style: [S.hint, { color: textMuted, marginBottom: 4 }] }, "User ID  (tap avatar \u2192 Copy ID)"),
                h(TextInput, {
                    style: [S.input, { color: textNorm, backgroundColor: bgTer, borderColor: canAdd ? brand + "66" : "transparent" }],
                    value: newId,
                    onChangeText: setNewId,
                    placeholder: "123456789012345678",
                    placeholderTextColor: textMuted,
                    keyboardType: "numeric"
                }),
                h(TouchableOpacity, {
                    style: [S.primaryBtn, { backgroundColor: canAdd ? brand : bgTer }],
                    onPress: handleAdd,
                    disabled: !canAdd
                }, h(Text, { style: S.primaryBtnTxt }, "Add User & Pick Emojis"))
            ),

            // ── Watched users list
            h(View, { style: [S.row, { marginTop: 20, marginBottom: 6 }] },
                h(Text, { style: [S.sectionLbl, { color: textNorm, marginTop: 0, flex: 1 }] },
                    "Watched Users (" + userKeys.length + ")")
            ),
            userKeys.length === 0
                ? h(View, { style: { alignItems: "center", paddingVertical: 40 } },
                    h(Text, { style: { fontSize: 36, marginBottom: 10 } }, "\uD83D\uDC64"),
                    h(Text, { style: [S.emptyTxt, { color: textMuted }] }, "No users added yet.\nAdd one above or use\n/autoreact-add.")
                )
                : userKeys.map(uid => h(UserCard, {
                    key: uid + tick,
                    userId: uid,
                    tick: tick,
                    onToggle: (u, v) => { storage.users[u].enabled = v; refresh(); },
                    onDelete: handleDelete,
                    onEdit:   setEdit,
                    onReactExisting: handleReactExisting
                }))
        );
    }

    // ─── Plugin lifecycle ────────────────────────────────────────────────────
    var index = {
        onLoad() {
            if (!storage.users) storage.users = {};

            registerCommands();

            interceptFn = function (payload) {
                if (payload.type !== "MESSAGE_CREATE" || payload.optimistic) return null;
                const authorId = payload.message?.author?.id;
                if (!authorId) return null;

                // Burst session (one-shot, ephemeral)
                if (burstSessions[authorId]) {
                    const sess = burstSessions[authorId];
                    reactToMessage(payload.channelId, payload.message.id, sess.emojis);
                    sess.remaining--;
                    if (sess.remaining <= 0) delete burstSessions[authorId];
                }

                // Persistent watched user
                const cfg = storage.users?.[authorId];
                if (cfg?.enabled && cfg.emojis?.length > 0) {
                    reactToMessage(payload.channelId, payload.message.id, cfg.emojis, cfg.superReact);
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
            unregCmds.forEach(fn => { try { fn(); } catch (_) {} });
            unregCmds.length = 0;
            Object.keys(burstSessions).forEach(k => delete burstSessions[k]);
        },

        settings: Settings
    };

    return index;
})();
