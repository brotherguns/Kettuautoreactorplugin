const vd = window.vendetta;
const { findByProps, findByStoreName } = vd.metro;
const { React, ReactNative: RN } = vd.ui.assets ? vd : {
    React: findByProps("createElement", "useState"),
    ReactNative: findByProps("View", "Text", "StyleSheet"),
};
const { createElement: h, useState } = React;
const { View, Text, TextInput, ScrollView, Switch, StyleSheet, Alert, TouchableOpacity } = RN;

const HTTP = findByProps("put", "del", "patch", "post", "get", "getAPIBaseURL");
const TokenStore = findByStoreName("UserAuthTokenStore") || findByStoreName("AuthenticationStore");
const FD = findByProps("_interceptors");
const tokens = findByProps("unsafe_rawColors", "colors");

// storage.users: { [userId]: { label: string, emojis: string[], enabled: boolean } }
const storage: Record<string, any> = vd.plugin.storage;
if (!storage.users) storage.users = {};

let interceptFn: ((p: any) => any) | null = null;

function getToken(): string {
    const ts = TokenStore as any;
    return ts.getToken ? ts.getToken() : ts.token;
}

function reactToMessage(channelId: string, msgId: string, emojis: string[]) {
    const token = getToken();
    for (const emoji of emojis) {
        const url = `https://discord.com/api/v9/channels/${channelId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}/@me`;
        (HTTP as any).put({ url, headers: { Authorization: token } }).catch(() => {});
    }
}

const S = StyleSheet.create({
    container: { flex: 1, padding: 16 },
    sectionTitle: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 16, opacity: 0.6 },
    card: { borderRadius: 12, marginBottom: 8, padding: 12 },
    row: { flexDirection: "row", alignItems: "center" },
    label: { fontSize: 15, fontWeight: "600", flex: 1 },
    uid: { fontSize: 11, opacity: 0.5, marginTop: 2 },
    emojiRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
    chip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 4, marginBottom: 4 },
    input: { borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 8, borderWidth: 1 },
    btn: { borderRadius: 8, padding: 10, alignItems: "center", marginTop: 4 },
    btnTxt: { fontSize: 14, fontWeight: "600" },
    smBtn: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 6 },
    smTxt: { fontSize: 12, fontWeight: "600" },
    hint: { fontSize: 11, opacity: 0.45, marginBottom: 6 },
    empty: { textAlign: "center", opacity: 0.4, marginTop: 32, fontSize: 15 },
});

function c(key: string, fallback: string): string {
    return (tokens as any)?.colors?.[key] || fallback;
}

function UserCard({ userId, onToggle, onDelete, onEdit }: any) {
    const cfg = storage.users[userId];
    return h(View, { style: [S.card, { backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31") }] },
        h(View, { style: S.row },
            h(View, { style: { flex: 1 } },
                h(Text, { style: [S.label, { color: c("TEXT_NORMAL", "#fff") }] }, cfg.label || userId),
                h(Text, { style: [S.uid, { color: c("TEXT_MUTED", "#aaa") }] }, "ID: " + userId),
            ),
            h(Switch, {
                value: cfg.enabled,
                onValueChange: (v: boolean) => onToggle(userId, v),
                trackColor: { true: c("BRAND_NEW", "#5865f2") },
            }),
            h(TouchableOpacity, {
                style: [S.smBtn, { backgroundColor: c("STATUS_DANGER", "#ed4245") }],
                onPress: () => onDelete(userId),
            }, h(Text, { style: [S.smTxt, { color: "#fff" }] }, "\u2715")),
        ),
        h(View, { style: S.emojiRow },
            cfg.emojis?.length > 0
                ? cfg.emojis.map((e: string, i: number) =>
                    h(View, { key: i, style: [S.chip, { backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22") }] },
                        h(Text, { style: { fontSize: 18 } }, e)
                    ))
                : h(Text, { style: [S.hint, { color: c("TEXT_MUTED", "#aaa") }] }, "No emojis"),
        ),
        h(TouchableOpacity, {
            style: [S.smBtn, { backgroundColor: c("BACKGROUND_TERTIARY", "#1e1f22"), marginTop: 6, alignSelf: "flex-start" }],
            onPress: () => onEdit(userId),
        }, h(Text, { style: [S.smTxt, { color: c("TEXT_NORMAL", "#fff") }] }, "Edit Emojis")),
    );
}

function Settings() {
    const [tick, setTick] = useState(0);
    const refresh = () => setTick((n: number) => n + 1);

    const [newId, setNewId] = useState("");
    const [newLabel, setNewLabel] = useState("");
    const [newEmojis, setNewEmojis] = useState("");
    const [editTarget, setEditTarget] = useState<string | null>(null);
    const [editInput, setEditInput] = useState("");

    const inputStyle = [S.input, {
        color: c("TEXT_NORMAL", "#fff"),
        backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31"),
        borderColor: c("BACKGROUND_TERTIARY", "#1e1f22"),
    }];

    function handleAdd() {
        const uid = newId.trim();
        if (!uid) return;
        const emojiList = newEmojis.trim().split(/[\s,]+/).filter(Boolean);
        storage.users[uid] = { label: newLabel.trim() || uid, emojis: emojiList, enabled: true };
        setNewId(""); setNewLabel(""); setNewEmojis("");
        refresh();
    }

    function handleDelete(uid: string) {
        Alert.alert("Remove User", `Remove ${storage.users[uid]?.label || uid}?`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => { delete storage.users[uid]; refresh(); } },
        ]);
    }

    function handleEdit(uid: string) {
        setEditTarget(uid);
        setEditInput((storage.users[uid]?.emojis || []).join(" "));
    }

    function handleSaveEmojis() {
        if (!editTarget) return;
        storage.users[editTarget].emojis = editInput.trim().split(/[\s,]+/).filter(Boolean);
        setEditTarget(null);
        refresh();
    }

    if (editTarget && storage.users[editTarget]) {
        return h(ScrollView, { style: [S.container, { backgroundColor: c("BACKGROUND_PRIMARY", "#313338") }] },
            h(Text, { style: [S.sectionTitle, { color: c("TEXT_NORMAL", "#fff") }] },
                `Emojis for ${storage.users[editTarget].label || editTarget}`),
            h(Text, { style: [S.hint, { color: c("TEXT_MUTED", "#aaa") }] }, "Space or comma separated"),
            h(TextInput, {
                style: inputStyle, value: editInput, onChangeText: setEditInput,
                placeholder: "\uD83D\uDC4D \uD83D\uDD25 \u2764\uFE0F",
                placeholderTextColor: c("TEXT_MUTED", "#aaa"), multiline: true,
            }),
            h(TouchableOpacity, { style: [S.btn, { backgroundColor: c("BRAND_NEW", "#5865f2") }], onPress: handleSaveEmojis },
                h(Text, { style: [S.btnTxt, { color: "#fff" }] }, "Save")),
            h(TouchableOpacity, {
                style: [S.btn, { backgroundColor: c("BACKGROUND_SECONDARY", "#2b2d31"), marginTop: 8 }],
                onPress: () => setEditTarget(null),
            }, h(Text, { style: [S.btnTxt, { color: c("TEXT_NORMAL", "#fff") }] }, "Cancel")),
        );
    }

    const userKeys = Object.keys(storage.users);

    return h(ScrollView, { style: [S.container, { backgroundColor: c("BACKGROUND_PRIMARY", "#313338") }] },
        h(Text, { style: [S.sectionTitle, { color: c("TEXT_NORMAL", "#fff") }] }, "Add User"),
        h(Text, { style: [S.hint, { color: c("TEXT_MUTED", "#aaa") }] }, "Display name (optional)"),
        h(TextInput, { style: inputStyle, value: newLabel, onChangeText: setNewLabel, placeholder: "John Doe", placeholderTextColor: c("TEXT_MUTED", "#aaa") }),
        h(Text, { style: [S.hint, { color: c("TEXT_MUTED", "#aaa") }] }, "User ID"),
        h(TextInput, { style: inputStyle, value: newId, onChangeText: setNewId, placeholder: "123456789012345678", placeholderTextColor: c("TEXT_MUTED", "#aaa"), keyboardType: "numeric" }),
        h(Text, { style: [S.hint, { color: c("TEXT_MUTED", "#aaa") }] }, "Emojis"),
        h(TextInput, { style: inputStyle, value: newEmojis, onChangeText: setNewEmojis, placeholder: "\uD83D\uDC4D \uD83D\uDD25", placeholderTextColor: c("TEXT_MUTED", "#aaa") }),
        h(TouchableOpacity, {
            style: [S.btn, { backgroundColor: newId.trim() ? c("BRAND_NEW", "#5865f2") : c("BACKGROUND_TERTIARY", "#1e1f22") }],
            onPress: handleAdd,
        }, h(Text, { style: [S.btnTxt, { color: newId.trim() ? "#fff" : c("TEXT_MUTED", "#aaa") }] }, "Add User")),

        h(Text, { style: [S.sectionTitle, { color: c("TEXT_NORMAL", "#fff"), marginTop: 24 }] },
            `Watched Users (${userKeys.length})`),
        userKeys.length === 0
            ? h(Text, { style: [S.empty, { color: c("TEXT_MUTED", "#aaa") }] }, "No users added yet")
            : userKeys.map((uid) => h(UserCard, { key: uid + tick, userId: uid, onToggle: (u: string, v: boolean) => { storage.users[u].enabled = v; refresh(); }, onDelete: handleDelete, onEdit: handleEdit })),
    );
}

export default {
    onLoad() {
        interceptFn = (payload: any) => {
            if (payload.type !== "MESSAGE_CREATE" || payload.optimistic) return null;
            const authorId = payload.message?.author?.id;
            if (!authorId) return null;
            const cfg = storage.users[authorId];
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
