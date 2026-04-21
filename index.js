// AutoReact plugin for Kettu/Bunny
(function () {
  var m = bunny.metro;
  var React = m.findByProps("createElement", "useState");
  var RN = m.findByProps("View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Switch", "StyleSheet", "Alert");

  var View = RN.View;
  var Text = RN.Text;
  var TextInput = RN.TextInput;
  var TouchableOpacity = RN.TouchableOpacity;
  var ScrollView = RN.ScrollView;
  var Switch = RN.Switch;
  var StyleSheet = RN.StyleSheet;
  var Alert = RN.Alert;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useCallback = React.useCallback;

  var TableSwitchRow = m.findByProps("TableSwitchRow") && m.findByProps("TableSwitchRow").TableSwitchRow;
  var TableRowGroup = m.findByProps("TableRowGroup") && m.findByProps("TableRowGroup").TableRowGroup;
  var Button = (function () { var mod = m.findByProps("Button"); return mod && mod.Button; })();
  var tokens = m.findByProps("unsafe_rawColors", "colors");

  var HTTP = m.findByProps("put", "del", "patch", "post", "get", "getAPIBaseURL");
  var TokenStore = m.findByStoreName("UserAuthTokenStore") || m.findByStoreName("AuthenticationStore");
  var FD = m.findByProps("_interceptors");

  // Storage: { users: { [userId]: { label: string, emojis: string[], enabled: boolean } } }
  var storage = plugin.createStorage();
  if (!storage.users) storage.users = {};

  var interceptFn = null;

  function getToken() {
    return TokenStore.getToken ? TokenStore.getToken() : TokenStore.token;
  }

  function reactToMessage(channelId, msgId, emojis) {
    var token = getToken();
    for (var i = 0; i < emojis.length; i++) {
      (function (emoji) {
        var url = "https://discord.com/api/v9/channels/" + channelId + "/messages/" + msgId + "/reactions/" + encodeURIComponent(emoji) + "/@me";
        HTTP.put({ url: url, headers: { "Authorization": token } }).catch(function () {});
      })(emojis[i]);
    }
  }

  // ─── Settings UI ─────────────────────────────────────────────────────────────

  var styles = StyleSheet.create({
    container: { flex: 1, padding: 16 },
    sectionTitle: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 16, opacity: 0.6 },
    card: { borderRadius: 12, marginBottom: 8, padding: 12 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    userLabel: { fontSize: 15, fontWeight: "600", flex: 1 },
    userId: { fontSize: 11, opacity: 0.5, marginTop: 2 },
    emojiRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 6, gap: 4 },
    emojiChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 4, marginBottom: 4 },
    emojiText: { fontSize: 18 },
    input: { borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 8, borderWidth: 1 },
    addBtn: { borderRadius: 8, padding: 10, alignItems: "center", marginTop: 4 },
    addBtnText: { fontSize: 14, fontWeight: "600" },
    deleteBtn: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 8 },
    deleteBtnText: { fontSize: 12, fontWeight: "600" },
    editBtn: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 4 },
    emptyText: { textAlign: "center", opacity: 0.4, marginTop: 32, fontSize: 15 },
    hint: { fontSize: 11, opacity: 0.45, marginBottom: 4 },
  });

  function UserCard(props) {
    var userId = props.userId;
    var config = props.config;
    var onToggle = props.onToggle;
    var onDelete = props.onDelete;
    var onEditEmojis = props.onEditEmojis;
    var colors = tokens ? tokens.colors : {};

    return React.createElement(View, { style: [styles.card, { backgroundColor: colors.BACKGROUND_SECONDARY || "#2b2d31" }] },
      React.createElement(View, { style: styles.row },
        React.createElement(View, { style: { flex: 1 } },
          React.createElement(Text, { style: [styles.userLabel, { color: colors.TEXT_NORMAL || "#fff" }] },
            config.label || userId
          ),
          React.createElement(Text, { style: [styles.userId, { color: colors.TEXT_MUTED || "#aaa" }] }, "ID: " + userId)
        ),
        React.createElement(Switch, {
          value: config.enabled,
          onValueChange: function (v) { onToggle(userId, v); },
          trackColor: { true: colors.BRAND_NEW || "#5865f2" },
        }),
        React.createElement(TouchableOpacity, { style: [styles.deleteBtn, { backgroundColor: colors.STATUS_DANGER || "#ed4245" }], onPress: function () { onDelete(userId); } },
          React.createElement(Text, { style: [styles.deleteBtnText, { color: "#fff" }] }, "✕")
        )
      ),
      React.createElement(View, { style: styles.emojiRow },
        config.emojis && config.emojis.length > 0
          ? config.emojis.map(function (e, i) {
              return React.createElement(TouchableOpacity, {
                key: i,
                style: [styles.emojiChip, { backgroundColor: colors.BACKGROUND_TERTIARY || "#1e1f22" }],
                onPress: function () { onEditEmojis(userId); }
              },
                React.createElement(Text, { style: styles.emojiText }, e)
              );
            })
          : React.createElement(Text, { style: [styles.hint, { color: colors.TEXT_MUTED || "#aaa" }] }, "No emojis — tap Edit to add")
      ),
      React.createElement(TouchableOpacity, {
        style: [styles.editBtn, { backgroundColor: colors.BACKGROUND_TERTIARY || "#1e1f22", marginTop: 6 }],
        onPress: function () { onEditEmojis(userId); }
      },
        React.createElement(Text, { style: { color: colors.TEXT_NORMAL || "#fff", fontSize: 12, fontWeight: "600" } }, "Edit Emojis")
      )
    );
  }

  function SettingsComponent() {
    var colors = tokens ? tokens.colors : {};

    var stateHook = useState(Object.assign({}, storage.users));
    var users = stateHook[0];
    var setUsers = stateHook[1];

    var inputHook = useState("");
    var newUserId = inputHook[0];
    var setNewUserId = inputHook[1];

    var labelHook = useState("");
    var newLabel = labelHook[0];
    var setNewLabel = labelHook[1];

    var emojiInputHook = useState("");
    var newEmojis = emojiInputHook[0];
    var setNewEmojis = emojiInputHook[1];

    var editTargetHook = useState(null);
    var editTarget = editTargetHook[0];
    var setEditTarget = editTargetHook[1];

    var editEmojiInputHook = useState("");
    var editEmojiInput = editEmojiInputHook[0];
    var setEditEmojiInput = editEmojiInputHook[1];

    function refresh() {
      setUsers(Object.assign({}, storage.users));
    }

    function handleToggle(userId, val) {
      storage.users[userId].enabled = val;
      refresh();
    }

    function handleDelete(userId) {
      Alert.alert("Remove User", "Remove " + (storage.users[userId].label || userId) + " from AutoReact?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove", style: "destructive", onPress: function () {
            delete storage.users[userId];
            refresh();
          }
        }
      ]);
    }

    function handleAdd() {
      var uid = newUserId.trim();
      if (!uid) return;
      var rawEmojis = newEmojis.trim();
      // Split by space or comma, filter empties
      var emojiList = rawEmojis.split(/[\s,]+/).filter(function (e) { return e.length > 0; });
      storage.users[uid] = {
        label: newLabel.trim() || uid,
        emojis: emojiList,
        enabled: true,
      };
      setNewUserId("");
      setNewLabel("");
      setNewEmojis("");
      refresh();
    }

    function handleEditEmojis(userId) {
      setEditTarget(userId);
      setEditEmojiInput((storage.users[userId].emojis || []).join(" "));
    }

    function handleSaveEmojis() {
      if (!editTarget) return;
      var emojiList = editEmojiInput.trim().split(/[\s,]+/).filter(function (e) { return e.length > 0; });
      storage.users[editTarget].emojis = emojiList;
      setEditTarget(null);
      setEditEmojiInput("");
      refresh();
    }

    var userKeys = Object.keys(users);

    // Emoji editor modal view
    if (editTarget) {
      return React.createElement(ScrollView, { style: [styles.container, { backgroundColor: colors.BACKGROUND_PRIMARY || "#313338" }] },
        React.createElement(Text, { style: [styles.sectionTitle, { color: colors.TEXT_NORMAL || "#fff" }] },
          "Editing emojis for " + (storage.users[editTarget] && storage.users[editTarget].label || editTarget)
        ),
        React.createElement(Text, { style: [styles.hint, { color: colors.TEXT_MUTED || "#aaa" }] },
          "Paste emojis separated by spaces or commas. Unicode and custom emojis both work."
        ),
        React.createElement(TextInput, {
          style: [styles.input, {
            color: colors.TEXT_NORMAL || "#fff",
            backgroundColor: colors.BACKGROUND_SECONDARY || "#2b2d31",
            borderColor: colors.BACKGROUND_TERTIARY || "#1e1f22",
          }],
          value: editEmojiInput,
          onChangeText: setEditEmojiInput,
          placeholder: "\uD83D\uDC4D \uD83D\uDD25 \u2764\uFE0F",
          placeholderTextColor: colors.TEXT_MUTED || "#aaa",
          multiline: true,
        }),
        React.createElement(TouchableOpacity, {
          style: [styles.addBtn, { backgroundColor: colors.BRAND_NEW || "#5865f2" }],
          onPress: handleSaveEmojis,
        },
          React.createElement(Text, { style: [styles.addBtnText, { color: "#fff" }] }, "Save")
        ),
        React.createElement(TouchableOpacity, {
          style: [styles.addBtn, { backgroundColor: colors.BACKGROUND_SECONDARY || "#2b2d31", marginTop: 8 }],
          onPress: function () { setEditTarget(null); },
        },
          React.createElement(Text, { style: [styles.addBtnText, { color: colors.TEXT_NORMAL || "#fff" }] }, "Cancel")
        )
      );
    }

    return React.createElement(ScrollView, { style: [styles.container, { backgroundColor: colors.BACKGROUND_PRIMARY || "#313338" }] },

      // ── Add User ────────────────────────────────────────────────────────────
      React.createElement(Text, { style: [styles.sectionTitle, { color: colors.TEXT_NORMAL || "#fff" }] }, "Add User"),

      React.createElement(Text, { style: [styles.hint, { color: colors.TEXT_MUTED || "#aaa" }] }, "Display name (optional)"),
      React.createElement(TextInput, {
        style: [styles.input, {
          color: colors.TEXT_NORMAL || "#fff",
          backgroundColor: colors.BACKGROUND_SECONDARY || "#2b2d31",
          borderColor: colors.BACKGROUND_TERTIARY || "#1e1f22",
        }],
        value: newLabel,
        onChangeText: setNewLabel,
        placeholder: "John Doe",
        placeholderTextColor: colors.TEXT_MUTED || "#aaa",
      }),

      React.createElement(Text, { style: [styles.hint, { color: colors.TEXT_MUTED || "#aaa" }] }, "User ID"),
      React.createElement(TextInput, {
        style: [styles.input, {
          color: colors.TEXT_NORMAL || "#fff",
          backgroundColor: colors.BACKGROUND_SECONDARY || "#2b2d31",
          borderColor: colors.BACKGROUND_TERTIARY || "#1e1f22",
        }],
        value: newUserId,
        onChangeText: setNewUserId,
        placeholder: "123456789012345678",
        placeholderTextColor: colors.TEXT_MUTED || "#aaa",
        keyboardType: "numeric",
      }),

      React.createElement(Text, { style: [styles.hint, { color: colors.TEXT_MUTED || "#aaa" }] }, "Emojis (space or comma separated)"),
      React.createElement(TextInput, {
        style: [styles.input, {
          color: colors.TEXT_NORMAL || "#fff",
          backgroundColor: colors.BACKGROUND_SECONDARY || "#2b2d31",
          borderColor: colors.BACKGROUND_TERTIARY || "#1e1f22",
        }],
        value: newEmojis,
        onChangeText: setNewEmojis,
        placeholder: "\uD83D\uDC4D \uD83D\uDD25",
        placeholderTextColor: colors.TEXT_MUTED || "#aaa",
      }),

      React.createElement(TouchableOpacity, {
        style: [styles.addBtn, { backgroundColor: newUserId.trim() ? (colors.BRAND_NEW || "#5865f2") : (colors.BACKGROUND_TERTIARY || "#1e1f22") }],
        onPress: handleAdd,
        disabled: !newUserId.trim(),
      },
        React.createElement(Text, { style: [styles.addBtnText, { color: newUserId.trim() ? "#fff" : (colors.TEXT_MUTED || "#aaa") }] }, "Add User")
      ),

      // ── Watched Users ────────────────────────────────────────────────────────
      React.createElement(Text, { style: [styles.sectionTitle, { color: colors.TEXT_NORMAL || "#fff", marginTop: 24 }] },
        "Watched Users (" + userKeys.length + ")"
      ),

      userKeys.length === 0
        ? React.createElement(Text, { style: [styles.emptyText, { color: colors.TEXT_MUTED || "#aaa" }] }, "No users added yet")
        : userKeys.map(function (uid) {
            return React.createElement(UserCard, {
              key: uid,
              userId: uid,
              config: users[uid],
              onToggle: handleToggle,
              onDelete: handleDelete,
              onEditEmojis: handleEditEmojis,
            });
          })
    );
  }

  // ─── Plugin lifecycle ─────────────────────────────────────────────────────

  return {
    start: function () {
      interceptFn = function (payload) {
        if (payload.type !== "MESSAGE_CREATE" || payload.optimistic) return null;
        var authorId = payload.message && payload.message.author && payload.message.author.id;
        if (!authorId) return null;
        var cfg = storage.users[authorId];
        if (cfg && cfg.enabled && cfg.emojis && cfg.emojis.length > 0) {
          reactToMessage(payload.channelId, payload.message.id, cfg.emojis);
        }
        return null;
      };
      FD._interceptors.push(interceptFn);
    },
    stop: function () {
      if (interceptFn) {
        FD._interceptors = FD._interceptors.filter(function (f) { return f !== interceptFn; });
        interceptFn = null;
      }
    },
    SettingsComponent: SettingsComponent,
  };
})();
