(function () {
    'use strict';

    const vd = window.vendetta;
    const { findByProps, findByStoreName } = vd.metro;
    const { createStorage, wrapSync, createMMKVBackend } = vd.storage;
    const React = findByProps("createElement", "useState");
    const RN = findByProps("View", "Text", "StyleSheet");
    const { createElement: h, useState, useEffect } = React;
    const { View, Text, TextInput, ScrollView, Switch, StyleSheet, Alert, TouchableOpacity, Image } = RN;
    const HTTP = findByProps("put", "del", "patch", "post", "get", "getAPIBaseURL");
    const TokenStore = findByStoreName("AuthenticationStore");
    const FD = findByProps("_interceptors");
    const EmojiStore = findByStoreName("EmojiStore");
    const GuildStore = findByStoreName("GuildStore");
    const SelectedGuildStore = findByStoreName("SelectedGuildStore");
    const MessageStore = findByStoreName("MessageStore");
    const SelectedChannelStore = findByStoreName("SelectedChannelStore");
    const tokens = findByProps("unsafe_rawColors", "colors");
    const storage = wrapSync(createStorage(createMMKVBackend("AutoReact")));
    let interceptFn = null;
    // Strip variation selector \uFE0F that iOS appends to many emoji — Discord rejects them
    function normalizeEmoji(str) {
        return str.replace(/\uFE0F/g, "");
    }
    function emojiToReactionString(e) {
        if (!e.id) return normalizeEmoji(e.name);
        return (e.animated ? "a:" : "") + e.name + ":" + e.id;
    }
    function getCustomEmojiId(reactionStr) {
        const m = reactionStr.match(/:(\d+)$/);
        return m ? m[1] : null;
    }
    function getCustomEmojiName(reactionStr) {
        const parts = reactionStr.split(":");
        if (parts.length === 2) return parts[0];
        if (parts.length === 3 && parts[0] === "a") return parts[1];
        return null;
    }
    function getToken() {
        return TokenStore.getToken();
    }
    // React to a single message with staggered timing to beat Discord rate limit
    function reactToMessage(channelId, msgId, emojis) {
        const token = getToken();
        emojis.forEach(function(emoji, i) {
            setTimeout(function() {
                const encoded = encodeURIComponent(normalizeEmoji(emoji));
                const url = "https://discord.com/api/v9/channels/" + channelId + "/messages/" + msgId + "/reactions/" + encoded + "/@me";
                HTTP.put({
                    url,
                    headers: {
                        Authorization: token
                    }
                }).catch(function() {});
            }, i * 350);
        });
    }
    // React to all cached messages from a specific user in a channel (last 50 max)
    function reactToExisting(userId) {
        var _storage_users, _cfg_emojis, _msgs_toArray;
        const cfg = (_storage_users = storage.users) === null || _storage_users === void 0 ? void 0 : _storage_users[userId];
        if (!(cfg === null || cfg === void 0 ? void 0 : cfg.enabled) || !((_cfg_emojis = cfg.emojis) === null || _cfg_emojis === void 0 ? void 0 : _cfg_emojis.length)) return;
        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) return;
        const msgs = MessageStore.getMessages(channelId);
        const arr = (msgs === null || msgs === void 0 ? void 0 : msgs._array) || (msgs === null || msgs === void 0 ? void 0 : (_msgs_toArray = msgs.toArray) === null || _msgs_toArray === void 0 ? void 0 : _msgs_toArray.call(msgs)) || [];
        const userMsgs = arr.filter((m)=>{
            var _m_author;
            return ((_m_author = m.author) === null || _m_author === void 0 ? void 0 : _m_author.id) === userId;
        }).slice(-20);
        userMsgs.forEach(function(msg, i) {
            setTimeout(function() {
                reactToMessage(channelId, msg.id, cfg.emojis);
            }, i * cfg.emojis.length * 400);
        });
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
            alignItems: "center",
            flexWrap: "wrap"
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
            marginBottom: 4,
            flexDirection: "row",
            alignItems: "center"
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
        },
        emojiPickerItem: {
            width: 56,
            height: 56,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            margin: 3
        },
        emojiPickerImg: {
            width: 36,
            height: 36,
            borderRadius: 4
        },
        emojiPickerTxt: {
            fontSize: 10,
            marginTop: 2,
            textAlign: "center"
        },
        guildBtn: {
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            marginRight: 6,
            marginBottom: 6
        },
        guildBtnTxt: {
            fontSize: 12,
            fontWeight: "600"
        },
        tabRow: {
            flexDirection: "row",
            marginBottom: 12
        },
        tab: {
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 6,
            marginRight: 8
        },
        tabTxt: {
            fontSize: 13,
            fontWeight: "600"
        }
    });
    function c(key, fallback) {
        var _tokens_colors;
        return (tokens === null || tokens === void 0 ? void 0 : (_tokens_colors = tokens.colors) === null || _tokens_colors === void 0 ? void 0 : _tokens_colors[key]) || fallback;
    }
    function EmojiChip({ reactionStr, onRemove }) {
        const id = getCustomEmojiId(reactionStr);
        const name = getCustomEmojiName(reactionStr);
        const imgUrl = id ? "https://cdn.discordapp.com/emojis/" + id + ".webp?size=32" : null;
        return h(View, {
            style: [
                S.chip,
                {
                    backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22")
                }
            ]
        }, imgUrl ? h(Image, {
            source: {
                uri: imgUrl
            },
            style: {
                width: 20,
                height: 20,
                borderRadius: 3,
                marginRight: 4
            }
        }) : h(Text, {
            style: {
                fontSize: 18
            }
        }, reactionStr), name ? h(Text, {
            style: {
                fontSize: 11,
                color: c("TEXT_MUTED", "#aaa")
            }
        }, ":" + name + ":") : null, onRemove ? h(TouchableOpacity, {
            onPress: onRemove,
            style: {
                marginLeft: 4
            }
        }, h(Text, {
            style: {
                fontSize: 12,
                color: c("TEXT_MUTED", "#aaa")
            }
        }, "\u2715")) : null);
    }
    function UserCard({ userId, onToggle, onDelete, onEdit, onReactExisting }) {
        var _cfg_emojis;
        const cfg = storage.users[userId];
        const brand = c("BRAND_NEW", "#5865f2");
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
                true: brand
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
        }, ((_cfg_emojis = cfg.emojis) === null || _cfg_emojis === void 0 ? void 0 : _cfg_emojis.length) > 0 ? cfg.emojis.map((e, i)=>h(EmojiChip, {
                key: i,
                reactionStr: e
            })) : h(Text, {
            style: [
                S.hint,
                {
                    color: c("TEXT_MUTED", "#aaa")
                }
            ]
        }, "No emojis \u2014 tap Edit")), h(View, {
            style: [
                S.row,
                {
                    marginTop: 8
                }
            ]
        }, h(TouchableOpacity, {
            style: [
                S.smBtn,
                {
                    backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22")
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
        }, "Edit Emojis")), h(TouchableOpacity, {
            style: [
                S.smBtn,
                {
                    backgroundColor: brand
                }
            ],
            onPress: ()=>onReactExisting(userId)
        }, h(Text, {
            style: [
                S.smTxt,
                {
                    color: "#fff"
                }
            ]
        }, "\u26a1 React Existing"))));
    }
    function EmojiEditor({ userId, onDone }) {
        const cfg = storage.users[userId];
        const [emojis, setEmojis] = useState((cfg === null || cfg === void 0 ? void 0 : cfg.emojis) || []);
        const [tab, setTab] = useState("server");
        const [unicodeInput, setUnicodeInput] = useState("");
        const [guildId, setGuildId] = useState(SelectedGuildStore.getGuildId() || "");
        const [serverEmojis, setServerEmojis] = useState([]);
        useEffect(()=>{
            if (guildId) {
                const list = EmojiStore.getGuildEmoji(guildId) || [];
                setServerEmojis(list);
            }
        }, [
            guildId
        ]);
        const guilds = GuildStore.getGuilds ? Object.values(GuildStore.getGuilds()) : [];
        function addEmoji(reactionStr) {
            if (emojis.includes(reactionStr)) return;
            const next = [
                ...emojis,
                reactionStr
            ];
            setEmojis(next);
            storage.users[userId].emojis = next;
        }
        function removeEmoji(reactionStr) {
            const next = emojis.filter((e)=>e !== reactionStr);
            setEmojis(next);
            storage.users[userId].emojis = next;
        }
        function addUnicode() {
            // Split on whitespace/commas, normalize each to strip \uFE0F
            const raw = unicodeInput.trim();
            // Split by spaces/commas but keep multi-codepoint emoji intact
            const list = [];
            // Simple greedy split by whitespace/comma
            raw.split(/[\s,]+/).forEach(function(part) {
                const normalized = normalizeEmoji(part.trim());
                if (normalized) list.push(normalized);
            });
            let next = [
                ...emojis
            ];
            list.forEach(function(e) {
                if (!next.includes(e)) next.push(e);
            });
            setEmojis(next);
            storage.users[userId].emojis = next;
            setUnicodeInput("");
        }
        const brand = c("BRAND_NEW", "#5865f2");
        const bgPri = {
            backgroundColor: c("BACKGROUND_PRIMARY", "#313338")
        };
        const bgSec = {
            backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31")
        };
        ({
            backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22")
        });
        const textNorm = {
            color: c("TEXT_NORMAL", "#fff")
        };
        const textMuted = {
            color: c("TEXT_MUTED", "#aaa")
        };
        const inputStyle = [
            S.input,
            textNorm,
            bgSec,
            {
                borderColor: c("BACKGROUND_TERTIARY", "#1e1f22")
            }
        ];
        return h(ScrollView, {
            style: [
                S.container,
                bgPri
            ]
        }, h(Text, {
            style: [
                S.sectionTitle,
                textNorm
            ]
        }, "Emojis for " + ((cfg === null || cfg === void 0 ? void 0 : cfg.label) || userId)), h(Text, {
            style: [
                S.hint,
                textMuted,
                {
                    marginTop: 8
                }
            ]
        }, "Tap an emoji to remove it:"), h(View, {
            style: S.emojiRow
        }, emojis.length === 0 ? h(Text, {
            style: [
                S.hint,
                textMuted
            ]
        }, "None added yet") : emojis.map((e, i)=>h(EmojiChip, {
                key: i,
                reactionStr: e,
                onRemove: ()=>removeEmoji(e)
            }))), h(View, {
            style: [
                S.tabRow,
                {
                    marginTop: 16
                }
            ]
        }, h(TouchableOpacity, {
            style: [
                S.tab,
                {
                    backgroundColor: tab === "server" ? brand : c("BACKGROUND_TERTIARY", "#1e1f22")
                }
            ],
            onPress: ()=>setTab("server")
        }, h(Text, {
            style: [
                S.tabTxt,
                {
                    color: "#fff"
                }
            ]
        }, "Server Emojis")), h(TouchableOpacity, {
            style: [
                S.tab,
                {
                    backgroundColor: tab === "unicode" ? brand : c("BACKGROUND_TERTIARY", "#1e1f22")
                }
            ],
            onPress: ()=>setTab("unicode")
        }, h(Text, {
            style: [
                S.tabTxt,
                {
                    color: "#fff"
                }
            ]
        }, "Unicode"))), tab === "server" ? h(View, null, h(Text, {
            style: [
                S.hint,
                textMuted
            ]
        }, "Pick a server:"), h(ScrollView, {
            horizontal: true,
            showsHorizontalScrollIndicator: false
        }, h(View, {
            style: {
                flexDirection: "row",
                paddingBottom: 8
            }
        }, guilds.slice(0, 100).map((g)=>h(TouchableOpacity, {
                key: g.id,
                style: [
                    S.guildBtn,
                    {
                        backgroundColor: g.id === guildId ? brand : c("BACKGROUND_TERTIARY", "#1e1f22")
                    }
                ],
                onPress: ()=>setGuildId(g.id)
            }, h(Text, {
                style: [
                    S.guildBtnTxt,
                    {
                        color: g.id === guildId ? "#fff" : c("TEXT_NORMAL", "#fff")
                    }
                ]
            }, g.name.slice(0, 18)))))), serverEmojis.length === 0 ? h(Text, {
            style: [
                S.empty,
                textMuted
            ]
        }, "No custom emojis in this server") : h(View, {
            style: {
                flexDirection: "row",
                flexWrap: "wrap"
            }
        }, serverEmojis.map((e)=>{
            const rs = emojiToReactionString(e);
            const selected = emojis.includes(rs);
            return h(TouchableOpacity, {
                key: e.id,
                style: [
                    S.emojiPickerItem,
                    {
                        backgroundColor: selected ? brand : c("BACKGROUND_SECONDARY", "#2b2d31")
                    }
                ],
                onPress: ()=>selected ? removeEmoji(rs) : addEmoji(rs)
            }, h(Image, {
                source: {
                    uri: "https://cdn.discordapp.com/emojis/" + e.id + ".webp?size=64"
                },
                style: S.emojiPickerImg
            }), h(Text, {
                style: [
                    S.emojiPickerTxt,
                    textMuted
                ],
                numberOfLines: 1
            }, e.name.slice(0, 8)));
        }))) : null, tab === "unicode" ? h(View, null, h(Text, {
            style: [
                S.hint,
                textMuted
            ]
        }, "Paste emoji separated by spaces. iOS variation selectors are stripped automatically."), h(TextInput, {
            style: inputStyle,
            value: unicodeInput,
            onChangeText: setUnicodeInput,
            placeholder: "\uD83D\uDC4D \uD83D\uDD25 \uD83D\uDE2D",
            placeholderTextColor: c("TEXT_MUTED", "#aaa"),
            multiline: true
        }), h(TouchableOpacity, {
            style: [
                S.btn,
                {
                    backgroundColor: unicodeInput.trim() ? brand : c("BACKGROUND_TERTIARY", "#1e1f22")
                }
            ],
            onPress: addUnicode
        }, h(Text, {
            style: [
                S.btnTxt,
                {
                    color: "#fff"
                }
            ]
        }, "Add"))) : null, h(TouchableOpacity, {
            style: [
                S.btn,
                bgSec,
                {
                    marginTop: 24
                }
            ],
            onPress: onDone
        }, h(Text, {
            style: [
                S.btnTxt,
                textNorm
            ]
        }, "\u2190 Back")));
    }
    function Settings() {
        var _storage_users;
        const [tick, setTick] = useState(0);
        const refresh = ()=>setTick((n)=>n + 1);
        const [newId, setNewId] = useState("");
        const [newLabel, setNewLabel] = useState("");
        const [editTarget, setEditTarget] = useState(null);
        if (editTarget && ((_storage_users = storage.users) === null || _storage_users === void 0 ? void 0 : _storage_users[editTarget])) {
            return h(EmojiEditor, {
                userId: editTarget,
                onDone: ()=>{
                    setEditTarget(null);
                    refresh();
                }
            });
        }
        const userKeys = Object.keys(storage.users || {});
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
            if (!storage.users) storage.users = {};
            storage.users[uid] = {
                label: newLabel.trim() || uid,
                emojis: [],
                enabled: true
            };
            setNewId("");
            setNewLabel("");
            setEditTarget(uid);
        }
        function handleDelete(uid) {
            var _storage_users_uid;
            Alert.alert("Remove User", "Remove " + (((_storage_users_uid = storage.users[uid]) === null || _storage_users_uid === void 0 ? void 0 : _storage_users_uid.label) || uid) + "?", [
                {
                    text: "Cancel",
                    style: "cancel"
                },
                {
                    text: "Remove",
                    style: "destructive",
                    onPress: ()=>{
                        delete storage.users[uid];
                        refresh();
                    }
                }
            ]);
        }
        function handleReactExisting(uid) {
            const cfg = storage.users[uid];
            if (!(cfg === null || cfg === void 0 ? void 0 : cfg.enabled)) {
                Alert.alert("User Disabled", "Enable this user first.");
                return;
            }
            reactToExisting(uid);
            Alert.alert("Done", "Reacting to recent messages from " + (cfg.label || uid) + " in current channel.");
        }
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
        }, "User ID (tap avatar \u2192 Copy ID)"), h(TextInput, {
            style: inputStyle,
            value: newId,
            onChangeText: setNewId,
            placeholder: "123456789012345678",
            placeholderTextColor: c("TEXT_MUTED", "#aaa"),
            keyboardType: "numeric"
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
                    color: "#fff"
                }
            ]
        }, "Add User & Pick Emojis")), h(Text, {
            style: [
                S.sectionTitle,
                {
                    color: c("TEXT_NORMAL", "#fff"),
                    marginTop: 24
                }
            ]
        }, "Watched Users (" + userKeys.length + ")"), userKeys.length === 0 ? h(Text, {
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
                    storage.users[u].enabled = v;
                    refresh();
                },
                onDelete: handleDelete,
                onEdit: setEditTarget,
                onReactExisting: handleReactExisting
            })));
    }
    var index = {
        onLoad () {
            if (!storage.users) storage.users = {};
            interceptFn = (payload)=>{
                var _payload_message_author, _payload_message, _storage_users, _cfg_emojis;
                if (payload.type !== "MESSAGE_CREATE" || payload.optimistic) return null;
                const authorId = (_payload_message = payload.message) === null || _payload_message === void 0 ? void 0 : (_payload_message_author = _payload_message.author) === null || _payload_message_author === void 0 ? void 0 : _payload_message_author.id;
                if (!authorId) return null;
                const cfg = (_storage_users = storage.users) === null || _storage_users === void 0 ? void 0 : _storage_users[authorId];
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
