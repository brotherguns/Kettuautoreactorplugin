(function () {
    'use strict';

    const vd = window.vendetta;
    const { findByProps, findByStoreName } = vd.metro;
    const { createStorage, wrapSync } = vd.storage;
    const React = findByProps("createElement", "useState");
    const RN = findByProps("View", "Text", "StyleSheet");
    const { createElement: h, useState } = React;
    const { View, Text, TextInput, ScrollView, Switch, StyleSheet, Alert, TouchableOpacity } = RN;
    const HTTP = findByProps("put", "del", "patch", "post", "get", "getAPIBaseURL");
    const TokenStore = findByStoreName("AuthenticationStore");
    const FD = findByProps("_interceptors");
    const tokens = findByProps("unsafe_rawColors", "colors");
    const storage = wrapSync(createStorage("AutoReact"));
    let interceptFn = null;
    function getToken() {
        return TokenStore.getToken();
    }
    function reactToMessage(channelId, msgId, emojis) {
        const token = getToken();
        for (const emoji of emojis){
            const url = `https://discord.com/api/v9/channels/${channelId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}/@me`;
            HTTP.put({
                url,
                headers: {
                    Authorization: token
                }
            }).catch(()=>{});
        }
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
    function UserCard({ userId, onToggle, onDelete, onEdit }) {
        var _cfg_emojis;
        const cfg = storage.users[userId];
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
        var _storage_users;
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
            const emojiList = newEmojis.trim().split(/[\s,]+/).filter(Boolean);
            if (!storage.users) storage.users = {};
            storage.users[uid] = {
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
            var _storage_users_uid;
            Alert.alert("Remove User", `Remove ${((_storage_users_uid = storage.users[uid]) === null || _storage_users_uid === void 0 ? void 0 : _storage_users_uid.label) || uid}?`, [
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
        function handleEdit(uid) {
            var _storage_users_uid;
            setEditTarget(uid);
            setEditInput((((_storage_users_uid = storage.users[uid]) === null || _storage_users_uid === void 0 ? void 0 : _storage_users_uid.emojis) || []).join(" "));
        }
        function handleSaveEmojis() {
            if (!editTarget) return;
            storage.users[editTarget].emojis = editInput.trim().split(/[\s,]+/).filter(Boolean);
            setEditTarget(null);
            refresh();
        }
        if (editTarget && ((_storage_users = storage.users) === null || _storage_users === void 0 ? void 0 : _storage_users[editTarget])) {
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
            }, `Emojis for ${storage.users[editTarget].label || editTarget}`), h(Text, {
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
        const userKeys = Object.keys(storage.users || {});
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
        }, "Emojis (space or comma separated)"), h(TextInput, {
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
                    storage.users[u].enabled = v;
                    refresh();
                },
                onDelete: handleDelete,
                onEdit: handleEdit
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
