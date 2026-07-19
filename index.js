(function () {
    'use strict';

    const vd = window.vendetta;
    const { findByProps, findByStoreName } = vd.metro;
    // window.vendetta does not expose React/ReactNative directly on this build
    // (vd.React is undefined even though vd.ui.assets exists), so always resolve
    // them through the metro module registry.
    const React = findByProps("createElement", "useState");
    const RN = findByProps("View", "Text", "StyleSheet");
    const { createElement: h, useState } = React;
    const { View, Text, TextInput, ScrollView, Switch, StyleSheet, Alert, TouchableOpacity } = RN;
    const HTTP = findByProps("put", "del", "patch", "post", "get", "getAPIBaseURL");
    const TokenStore = findByStoreName("UserAuthTokenStore") || findByStoreName("AuthenticationStore");
    const FD = findByProps("_interceptors");
    const tokens = findByProps("unsafe_rawColors", "colors");
    // window.vendetta.plugin is undefined at bundle scope (the plugin context is
    // only passed as the loader's arrow param, which this IIFE doesn't consume), so
    // create our own MMKV-backed storage instead of reading vd.plugin.storage.
    // users map: { [userId]: { label: string, emojis: string[], enabled: boolean } }
    const { createStorage, wrapSync, createMMKVBackend } = vd.storage;
    const storage = wrapSync(createStorage(createMMKVBackend("AutoReact")));
    // wrapSync storage hydrates asynchronously, so getUsers() can be undefined at
    // first read/render. Always go through this to guarantee it exists (bracket
    // access here is intentional so it isn't rewritten to a recursive call).
    function getUsers() {
        if (!storage["users"]) storage["users"] = {};
        return storage["users"];
    }
    let interceptFn = null;
    function getToken() {
        const ts = TokenStore;
        return ts.getToken ? ts.getToken() : ts.token;
    }
    const API_BASE = "https://discord.com/api/v9";
    const REACT_SPACING_MS = 350; // gap between reactions to stay under the rate limit
    const MAX_429_RETRIES = 5; // per-emoji retries when rate limited
    const MAX_VERIFY_ROUNDS = 3; // re-check + re-apply passes after reacting
    const VERIFY_DELAY_MS = 1500; // let reactions settle before verifying
    function delay(ms) {
        return new Promise((resolve)=>setTimeout(resolve, ms));
    }
    // Custom emoji ("<:name:id>", "<a:name:id>" or "name:id") -> "name:id" for the API path.
    // Anything else is treated as a unicode emoji and URL-encoded.
    function toApiEmoji(raw) {
        const m = /^<?a?:([^:>]+):(\d{15,})>?$/.exec(raw.trim());
        if (m) return `${m[1]}:${m[2]}`;
        return encodeURIComponent(raw.trim());
    }
    // Canonical identity used to check a configured emoji against message.reactions.
    function emojiIdentity(raw) {
        const m = /^<?a?:([^:>]+):(\d{15,})>?$/.exec(raw.trim());
        if (m) return {
            id: m[2]
        };
        return {
            name: raw.trim()
        };
    }
    function putReaction(channelId, msgId, raw) {
        const url = `${API_BASE}/channels/${channelId}/messages/${msgId}/reactions/${toApiEmoji(raw)}/@me`;
        return HTTP.put({
            url,
            headers: {
                Authorization: getToken()
            }
        });
    }
    function getMessage(channelId, msgId) {
        const url = `${API_BASE}/channels/${channelId}/messages/${msgId}`;
        return HTTP.get({
            url,
            headers: {
                Authorization: getToken()
            }
        });
    }
    // Apply one emoji, backing off and retrying when Discord rate-limits us (429).
    function applyOne(channelId, msgId, raw, attempt) {
        return putReaction(channelId, msgId, raw).then(()=>delay(REACT_SPACING_MS), (err)=>{
            if ((err === null || err === void 0 ? void 0 : err.status) === 429 && attempt < MAX_429_RETRIES) {
                var _err_body;
                const retryAfter = err === null || err === void 0 ? void 0 : (_err_body = err.body) === null || _err_body === void 0 ? void 0 : _err_body.retry_after;
                const wait = retryAfter ? Math.ceil(retryAfter * 1000) + 100 : 1000;
                return delay(wait).then(()=>applyOne(channelId, msgId, raw, attempt + 1));
            }
            // Non-429 (already reacted, unknown emoji, transient) — move on; verify catches real gaps.
            return delay(REACT_SPACING_MS);
        });
    }
    function hasMyReaction(reactions, raw) {
        const want = emojiIdentity(raw);
        for (const r of reactions){
            if (!(r === null || r === void 0 ? void 0 : r.me)) continue;
            const em = r.emoji || {};
            if (want.id) {
                if (em.id === want.id) return true;
            } else if (!em.id && em.name === want.name) {
                return true;
            }
        }
        return false;
    }
    // After reacting, fetch the message and confirm every configured emoji actually
    // landed; re-apply any that didn't (rate limits / transient failures) for a few rounds.
    function verifyAndFix(channelId, msgId, emojis, round) {
        if (round >= MAX_VERIFY_ROUNDS) return Promise.resolve();
        return getMessage(channelId, msgId).then((res)=>{
            var _res_body;
            const reactions = (res === null || res === void 0 ? void 0 : (_res_body = res.body) === null || _res_body === void 0 ? void 0 : _res_body.reactions) || [];
            const missing = emojis.filter((e)=>!hasMyReaction(reactions, e));
            if (missing.length === 0) return;
            // NB: forEach (not for-of) — Hermes on this build does NOT create a
            // fresh per-iteration binding for let/const loop variables, so a
            // `for (const e of missing) ...() => applyOne(e)` closure would
            // capture the LAST value only. forEach's param is function-scoped.
            let chain = Promise.resolve();
            missing.forEach((e)=>{
                chain = chain.then(()=>applyOne(channelId, msgId, e, 0));
            });
            return chain.then(()=>delay(VERIFY_DELAY_MS)).then(()=>verifyAndFix(channelId, msgId, emojis, round + 1));
        }, ()=>undefined);
    }
    function reactToMessage(channelId, msgId, emojis) {
        // Apply sequentially (not in parallel) so we don't trip the reaction rate limit
        // and silently drop emojis, then verify + backfill any that didn't stick.
        // NB: forEach (not for-of) — see verifyAndFix; Hermes captures the loop
        // variable by reference, so for-of would react with only the last emoji.
        let chain = Promise.resolve();
        emojis.forEach((emoji)=>{
            chain = chain.then(()=>applyOne(channelId, msgId, emoji, 0));
        });
        chain.then(()=>delay(VERIFY_DELAY_MS)).then(()=>verifyAndFix(channelId, msgId, emojis, 0)).catch(()=>{});
    }
    const S = StyleSheet.create({
        container: {
            flex: 1,
            padding: 16
        },
        sectionTitle: {
            fontSize: 12,
            fontWeight: "600",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            marginBottom: 8,
            marginTop: 16,
            opacity: 0.6
        },
        card: {
            borderRadius: 12,
            marginBottom: 8,
            padding: 12
        },
        row: {
            flexDirection: "row",
            alignItems: "center"
        },
        label: {
            fontSize: 15,
            fontWeight: "600",
            flex: 1
        },
        uid: {
            fontSize: 11,
            opacity: 0.5,
            marginTop: 2
        },
        emojiRow: {
            flexDirection: "row",
            flexWrap: "wrap",
            marginTop: 6
        },
        chip: {
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 4,
            marginRight: 4,
            marginBottom: 4
        },
        input: {
            borderRadius: 8,
            padding: 10,
            fontSize: 14,
            marginBottom: 8,
            borderWidth: 1
        },
        btn: {
            borderRadius: 8,
            padding: 10,
            alignItems: "center",
            marginTop: 4
        },
        btnTxt: {
            fontSize: 14,
            fontWeight: "600"
        },
        smBtn: {
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 4,
            marginLeft: 6
        },
        smTxt: {
            fontSize: 12,
            fontWeight: "600"
        },
        hint: {
            fontSize: 11,
            opacity: 0.45,
            marginBottom: 6
        },
        empty: {
            textAlign: "center",
            opacity: 0.4,
            marginTop: 32,
            fontSize: 15
        }
    });
    function c(key, fallback) {
        var _tokens_colors;
        return (tokens === null || tokens === void 0 ? void 0 : (_tokens_colors = tokens.colors) === null || _tokens_colors === void 0 ? void 0 : _tokens_colors[key]) || fallback;
    }
    // Split a settings text field into individual emojis. There's no Intl.Segmenter
    // on this build, and the OS emoji keyboard inserts emojis with no separators, so
    // a plain whitespace split leaves several emojis mashed into one token — and only
    // that one "emoji" ever reacts. Split each whitespace/comma token into emoji
    // grapheme clusters via a Unicode-property regex; custom Discord emoji tokens
    // (<:name:id>, <a:name:id>, name:id) are kept intact.
    const EMOJI_CLUSTER_RE = /(?:<a?:[^:>\s]+:\d{15,}>)|(?:\p{Regional_Indicator}\p{Regional_Indicator})|(?:[\d#*]️?⃣)|(?:\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️)?(?:‍\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️)?)*)/gu;
    function parseEmojis(text) {
        const out = [];
        const tokens = text.trim().split(/[\s,]+/).filter(Boolean);
        tokens.forEach((tok)=>{
            if (/^:?[^:>\s]+:\d{15,}$/.test(tok)) {
                out.push(tok);
                return;
            }
            const m = tok.match(EMOJI_CLUSTER_RE);
            if (m && m.length) m.forEach((e)=>out.push(e));
            else out.push(tok);
        });
        return out;
    }
    function UserCard({ userId, onToggle, onDelete, onEdit }) {
        var _cfg_emojis;
        const cfg = getUsers()[userId];
        return h(View, {
            style: [
                S.card,
                {
                    backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31")
                }
            ]
        }, h(View, {
            style: S.row
        }, h(View, {
            style: {
                flex: 1
            }
        }, h(Text, {
            style: [
                S.label,
                {
                    color: c("TEXT_NORMAL", "#fff")
                }
            ]
        }, cfg.label || userId), h(Text, {
            style: [
                S.uid,
                {
                    color: c("TEXT_MUTED", "#aaa")
                }
            ]
        }, "ID: " + userId)), h(Switch, {
            value: cfg.enabled,
            onValueChange: (v)=>onToggle(userId, v),
            trackColor: {
                true: c("BRAND_NEW", "#5865f2")
            }
        }), h(TouchableOpacity, {
            style: [
                S.smBtn,
                {
                    backgroundColor: c("STATUS_DANGER", "#ed4245")
                }
            ],
            onPress: ()=>onDelete(userId)
        }, h(Text, {
            style: [
                S.smTxt,
                {
                    color: "#fff"
                }
            ]
        }, "\u2715"))), h(View, {
            style: S.emojiRow
        }, ((_cfg_emojis = cfg.emojis) === null || _cfg_emojis === void 0 ? void 0 : _cfg_emojis.length) > 0 ? cfg.emojis.map((e, i)=>h(View, {
                key: i,
                style: [
                    S.chip,
                    {
                        backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22")
                    }
                ]
            }, h(Text, {
                style: {
                    fontSize: 18
                }
            }, e))) : h(Text, {
            style: [
                S.hint,
                {
                    color: c("TEXT_MUTED", "#aaa")
                }
            ]
        }, "No emojis")), h(TouchableOpacity, {
            style: [
                S.smBtn,
                {
                    backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22"),
                    marginTop: 6,
                    alignSelf: "flex-start"
                }
            ],
            onPress: ()=>onEdit(userId)
        }, h(Text, {
            style: [
                S.smTxt,
                {
                    color: c("TEXT_NORMAL", "#fff")
                }
            ]
        }, "Edit Emojis")));
    }
    function Settings() {
        const [tick, setTick] = useState(0);
        const refresh = ()=>setTick((n)=>n + 1);
        const [newId, setNewId] = useState("");
        const [newLabel, setNewLabel] = useState("");
        const [newEmojis, setNewEmojis] = useState("");
        const [editTarget, setEditTarget] = useState(null);
        const [editInput, setEditInput] = useState("");
        const inputStyle = [
            S.input,
            {
                color: c("TEXT_NORMAL", "#fff"),
                backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31"),
                borderColor: c("BACKGROUND_TERTIARY", "#1e1f22")
            }
        ];
        function handleAdd() {
            const uid = newId.trim();
            if (!uid) return;
            const emojiList = parseEmojis(newEmojis);
            getUsers()[uid] = {
                label: newLabel.trim() || uid,
                emojis: emojiList,
                enabled: true
            };
            setNewId("");
            setNewLabel("");
            setNewEmojis("");
            refresh();
        }
        function handleDelete(uid) {
            var _getUsers_uid;
            Alert.alert("Remove User", `Remove ${((_getUsers_uid = getUsers()[uid]) === null || _getUsers_uid === void 0 ? void 0 : _getUsers_uid.label) || uid}?`, [
                {
                    text: "Cancel",
                    style: "cancel"
                },
                {
                    text: "Remove",
                    style: "destructive",
                    onPress: ()=>{
                        delete getUsers()[uid];
                        refresh();
                    }
                }
            ]);
        }
        function handleEdit(uid) {
            var _getUsers_uid;
            setEditTarget(uid);
            setEditInput((((_getUsers_uid = getUsers()[uid]) === null || _getUsers_uid === void 0 ? void 0 : _getUsers_uid.emojis) || []).join(" "));
        }
        function handleSaveEmojis() {
            if (!editTarget) return;
            getUsers()[editTarget].emojis = parseEmojis(editInput);
            setEditTarget(null);
            refresh();
        }
        if (editTarget && getUsers()[editTarget]) {
            return h(ScrollView, {
                style: [
                    S.container,
                    {
                        backgroundColor: c("BACKGROUND_PRIMARY", "#313338")
                    }
                ]
            }, h(Text, {
                style: [
                    S.sectionTitle,
                    {
                        color: c("TEXT_NORMAL", "#fff")
                    }
                ]
            }, `Emojis for ${getUsers()[editTarget].label || editTarget}`), h(Text, {
                style: [
                    S.hint,
                    {
                        color: c("TEXT_MUTED", "#aaa")
                    }
                ]
            }, "Space or comma separated"), h(TextInput, {
                style: inputStyle,
                value: editInput,
                onChangeText: setEditInput,
                placeholder: "\uD83D\uDC4D \uD83D\uDD25 \u2764\uFE0F",
                placeholderTextColor: c("TEXT_MUTED", "#aaa"),
                multiline: true
            }), h(TouchableOpacity, {
                style: [
                    S.btn,
                    {
                        backgroundColor: c("BRAND_NEW", "#5865f2")
                    }
                ],
                onPress: handleSaveEmojis
            }, h(Text, {
                style: [
                    S.btnTxt,
                    {
                        color: "#fff"
                    }
                ]
            }, "Save")), h(TouchableOpacity, {
                style: [
                    S.btn,
                    {
                        backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31"),
                        marginTop: 8
                    }
                ],
                onPress: ()=>setEditTarget(null)
            }, h(Text, {
                style: [
                    S.btnTxt,
                    {
                        color: c("TEXT_NORMAL", "#fff")
                    }
                ]
            }, "Cancel")));
        }
        const userKeys = Object.keys(getUsers());
        return h(ScrollView, {
            style: [
                S.container,
                {
                    backgroundColor: c("BACKGROUND_PRIMARY", "#313338")
                }
            ]
        }, h(Text, {
            style: [
                S.sectionTitle,
                {
                    color: c("TEXT_NORMAL", "#fff")
                }
            ]
        }, "Add User"), h(Text, {
            style: [
                S.hint,
                {
                    color: c("TEXT_MUTED", "#aaa")
                }
            ]
        }, "Display name (optional)"), h(TextInput, {
            style: inputStyle,
            value: newLabel,
            onChangeText: setNewLabel,
            placeholder: "John Doe",
            placeholderTextColor: c("TEXT_MUTED", "#aaa")
        }), h(Text, {
            style: [
                S.hint,
                {
                    color: c("TEXT_MUTED", "#aaa")
                }
            ]
        }, "User ID"), h(TextInput, {
            style: inputStyle,
            value: newId,
            onChangeText: setNewId,
            placeholder: "123456789012345678",
            placeholderTextColor: c("TEXT_MUTED", "#aaa"),
            keyboardType: "numeric"
        }), h(Text, {
            style: [
                S.hint,
                {
                    color: c("TEXT_MUTED", "#aaa")
                }
            ]
        }, "Emojis"), h(TextInput, {
            style: inputStyle,
            value: newEmojis,
            onChangeText: setNewEmojis,
            placeholder: "\uD83D\uDC4D \uD83D\uDD25",
            placeholderTextColor: c("TEXT_MUTED", "#aaa")
        }), h(TouchableOpacity, {
            style: [
                S.btn,
                {
                    backgroundColor: newId.trim() ? c("BRAND_NEW", "#5865f2") : c("BACKGROUND_TERTIARY", "#1e1f22")
                }
            ],
            onPress: handleAdd
        }, h(Text, {
            style: [
                S.btnTxt,
                {
                    color: newId.trim() ? "#fff" : c("TEXT_MUTED", "#aaa")
                }
            ]
        }, "Add User")), h(Text, {
            style: [
                S.sectionTitle,
                {
                    color: c("TEXT_NORMAL", "#fff"),
                    marginTop: 24
                }
            ]
        }, `Watched Users (${userKeys.length})`), userKeys.length === 0 ? h(Text, {
            style: [
                S.empty,
                {
                    color: c("TEXT_MUTED", "#aaa")
                }
            ]
        }, "No users added yet") : userKeys.map((uid)=>h(UserCard, {
                key: uid + tick,
                userId: uid,
                onToggle: (u, v)=>{
                    getUsers()[u].enabled = v;
                    refresh();
                },
                onDelete: handleDelete,
                onEdit: handleEdit
            })));
    }
    var index = {
        onLoad () {
            interceptFn = (payload)=>{
                var _payload_message_author, _payload_message, _cfg_emojis;
                if (payload.type !== "MESSAGE_CREATE" || payload.optimistic) return null;
                const authorId = (_payload_message = payload.message) === null || _payload_message === void 0 ? void 0 : (_payload_message_author = _payload_message.author) === null || _payload_message_author === void 0 ? void 0 : _payload_message_author.id;
                if (!authorId) return null;
                const cfg = getUsers()[authorId];
                if ((cfg === null || cfg === void 0 ? void 0 : cfg.enabled) && ((_cfg_emojis = cfg.emojis) === null || _cfg_emojis === void 0 ? void 0 : _cfg_emojis.length) > 0) {
                    reactToMessage(payload.channelId, payload.message.id, cfg.emojis);
                }
                return null;
            };
            FD._interceptors.push(interceptFn);
        },
        onUnload () {
            if (interceptFn) {
                FD._interceptors = FD._interceptors.filter((f)=>f !== interceptFn);
                interceptFn = null;
            }
        },
        settings: Settings
    };

    return index;

})();
