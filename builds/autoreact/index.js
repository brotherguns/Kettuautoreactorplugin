// AutoReact - auto-reacts to messages from watched users
// Kettu wraps this as: (bunny, definePlugin) => { {this code}; return plugin?.default ?? plugin; }
// so we declare `var plugin` which gets returned

var m = bunny.metro;
var React = m.findByProps("createElement", "useState");
var RN = m.findByProps("View", "Text", "TextInput", "ScrollView", "Switch", "StyleSheet", "Alert");

var View = RN.View;
var Text = RN.Text;
var TextInput = RN.TextInput;
var ScrollView = RN.ScrollView;
var Switch = RN.Switch;
var StyleSheet = RN.StyleSheet;
var Alert = RN.Alert;
var useState = React.useState;

var TouchableOpacity = m.findByProps("TouchableOpacity").TouchableOpacity;
var tokens = m.findByProps("unsafe_rawColors", "colors");

var HTTP = m.findByProps("put", "del", "patch", "post", "get", "getAPIBaseURL");
var TokenStore = m.findByStoreName("UserAuthTokenStore") || m.findByStoreName("AuthenticationStore");
var FD = m.findByProps("_interceptors");

// storage lives at bunny.plugin.createStorage(), not to be confused with the `plugin` var we declare below
var storage = bunny.plugin.createStorage();
if (!storage.users) storage.users = {};

var interceptFn = null;

function getToken() {
  return TokenStore.getToken ? TokenStore.getToken() : TokenStore.token;
}

function reactToMessage(channelId, msgId, emojis) {
  var token = getToken();
  for (var i = 0; i < emojis.length; i++) {
    (function(emoji) {
      var url = "https://discord.com/api/v9/channels/" + channelId + "/messages/" + msgId + "/reactions/" + encodeURIComponent(emoji) + "/@me";
      HTTP.put({ url: url, headers: { "Authorization": token } }).catch(function() {});
    })(emojis[i]);
  }
}

var styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 16, opacity: 0.6 },
  card: { borderRadius: 12, marginBottom: 8, padding: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  userLabel: { fontSize: 15, fontWeight: "600", flex: 1 },
  userId: { fontSize: 11, opacity: 0.5, marginTop: 2 },
  emojiRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  emojiChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 4, marginBottom: 4 },
  emojiText: { fontSize: 18 },
  input: { borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 8, borderWidth: 1 },
  btn: { borderRadius: 8, padding: 10, alignItems: "center", marginTop: 4 },
  btnText: { fontSize: 14, fontWeight: "600" },
  smBtn: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 6 },
  smBtnText: { fontSize: 12, fontWeight: "600" },
  hint: { fontSize: 11, opacity: 0.45, marginBottom: 6 },
  emptyText: { textAlign: "center", opacity: 0.4, marginTop: 32, fontSize: 15 },
});

function UserCard(props) {
  var uid = props.userId;
  var cfg = props.config;
  var c = tokens ? tokens.colors : {};

  return React.createElement(View, { style: [styles.card, { backgroundColor: c.BACKGROUND_SECONDARY || "#2b2d31" }] },
    React.createElement(View, { style: styles.row },
      React.createElement(View, { style: { flex: 1 } },
        React.createElement(Text, { style: [styles.userLabel, { color: c.TEXT_NORMAL || "#fff" }] }, cfg.label || uid),
        React.createElement(Text, { style: [styles.userId, { color: c.TEXT_MUTED || "#aaa" }] }, "ID: " + uid)
      ),
      React.createElement(Switch, {
        value: cfg.enabled,
        onValueChange: function(v) { props.onToggle(uid, v); },
        trackColor: { true: c.BRAND_NEW || "#5865f2" },
      }),
      React.createElement(TouchableOpacity, {
        style: [styles.smBtn, { backgroundColor: c.STATUS_DANGER || "#ed4245" }],
        onPress: function() { props.onDelete(uid); }
      }, React.createElement(Text, { style: [styles.smBtnText, { color: "#fff" }] }, "\u2715"))
    ),
    React.createElement(View, { style: styles.emojiRow },
      cfg.emojis && cfg.emojis.length > 0
        ? cfg.emojis.map(function(e, i) {
            return React.createElement(View, { key: i, style: [styles.emojiChip, { backgroundColor: c.BACKGROUND_TERTIARY || "#1e1f22" }] },
              React.createElement(Text, { style: styles.emojiText }, e)
            );
          })
        : React.createElement(Text, { style: [styles.hint, { color: c.TEXT_MUTED || "#aaa" }] }, "No emojis")
    ),
    React.createElement(TouchableOpacity, {
      style: [styles.smBtn, { backgroundColor: c.BACKGROUND_TERTIARY || "#1e1f22", marginTop: 6, alignSelf: "flex-start" }],
      onPress: function() { props.onEditEmojis(uid); }
    }, React.createElement(Text, { style: [styles.smBtnText, { color: c.TEXT_NORMAL || "#fff" }] }, "Edit Emojis"))
  );
}

function SettingsComponent() {
  var c = tokens ? tokens.colors : {};
  var usersHook = useState(0); // increment to force re-render
  var tick = usersHook[0];
  var setTick = usersHook[1];
  var refresh = function() { setTick(function(n) { return n + 1; }); };

  var inputHook = useState("");
  var newId = inputHook[0]; var setNewId = inputHook[1];
  var labelHook = useState("");
  var newLabel = labelHook[0]; var setNewLabel = labelHook[1];
  var emojiHook = useState("");
  var newEmojis = emojiHook[0]; var setNewEmojis = emojiHook[1];

  var editTargetHook = useState(null);
  var editTarget = editTargetHook[0]; var setEditTarget = editTargetHook[1];
  var editInputHook = useState("");
  var editInput = editInputHook[0]; var setEditInput = editInputHook[1];

  function handleAdd() {
    var uid = newId.trim();
    if (!uid) return;
    var emojiList = newEmojis.trim().split(/[\s,]+/).filter(function(e) { return e.length > 0; });
    storage.users[uid] = { label: newLabel.trim() || uid, emojis: emojiList, enabled: true };
    setNewId(""); setNewLabel(""); setNewEmojis("");
    refresh();
  }

  function handleToggle(uid, val) {
    storage.users[uid].enabled = val;
    refresh();
  }

  function handleDelete(uid) {
    Alert.alert("Remove User", "Remove " + (storage.users[uid].label || uid) + "?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: function() { delete storage.users[uid]; refresh(); } }
    ]);
  }

  function handleEditEmojis(uid) {
    setEditTarget(uid);
    setEditInput((storage.users[uid].emojis || []).join(" "));
  }

  function handleSaveEmojis() {
    var emojiList = editInput.trim().split(/[\s,]+/).filter(function(e) { return e.length > 0; });
    storage.users[editTarget].emojis = emojiList;
    setEditTarget(null);
    refresh();
  }

  var inputStyle = [styles.input, { color: c.TEXT_NORMAL || "#fff", backgroundColor: c.BACKGROUND_SECONDARY || "#2b2d31", borderColor: c.BACKGROUND_TERTIARY || "#1e1f22" }];

  if (editTarget && storage.users[editTarget]) {
    return React.createElement(ScrollView, { style: [styles.container, { backgroundColor: c.BACKGROUND_PRIMARY || "#313338" }] },
      React.createElement(Text, { style: [styles.sectionTitle, { color: c.TEXT_NORMAL || "#fff" }] },
        "Emojis for " + (storage.users[editTarget].label || editTarget)
      ),
      React.createElement(Text, { style: [styles.hint, { color: c.TEXT_MUTED || "#aaa" }] },
        "Paste emojis separated by spaces or commas"
      ),
      React.createElement(TextInput, {
        style: inputStyle,
        value: editInput,
        onChangeText: setEditInput,
        placeholder: "\uD83D\uDC4D \uD83D\uDD25 \u2764\uFE0F",
        placeholderTextColor: c.TEXT_MUTED || "#aaa",
        multiline: true,
      }),
      React.createElement(TouchableOpacity, { style: [styles.btn, { backgroundColor: c.BRAND_NEW || "#5865f2" }], onPress: handleSaveEmojis },
        React.createElement(Text, { style: [styles.btnText, { color: "#fff" }] }, "Save")
      ),
      React.createElement(TouchableOpacity, { style: [styles.btn, { backgroundColor: c.BACKGROUND_SECONDARY || "#2b2d31", marginTop: 8 }], onPress: function() { setEditTarget(null); } },
        React.createElement(Text, { style: [styles.btnText, { color: c.TEXT_NORMAL || "#fff" }] }, "Cancel")
      )
    );
  }

  var userKeys = Object.keys(storage.users);

  return React.createElement(ScrollView, { style: [styles.container, { backgroundColor: c.BACKGROUND_PRIMARY || "#313338" }] },
    React.createElement(Text, { style: [styles.sectionTitle, { color: c.TEXT_NORMAL || "#fff" }] }, "Add User"),
    React.createElement(Text, { style: [styles.hint, { color: c.TEXT_MUTED || "#aaa" }] }, "Display name (optional)"),
    React.createElement(TextInput, { style: inputStyle, value: newLabel, onChangeText: setNewLabel, placeholder: "John Doe", placeholderTextColor: c.TEXT_MUTED || "#aaa" }),
    React.createElement(Text, { style: [styles.hint, { color: c.TEXT_MUTED || "#aaa" }] }, "User ID"),
    React.createElement(TextInput, { style: inputStyle, value: newId, onChangeText: setNewId, placeholder: "123456789012345678", placeholderTextColor: c.TEXT_MUTED || "#aaa", keyboardType: "numeric" }),
    React.createElement(Text, { style: [styles.hint, { color: c.TEXT_MUTED || "#aaa" }] }, "Emojis (space or comma separated)"),
    React.createElement(TextInput, { style: inputStyle, value: newEmojis, onChangeText: setNewEmojis, placeholder: "\uD83D\uDC4D \uD83D\uDD25", placeholderTextColor: c.TEXT_MUTED || "#aaa" }),
    React.createElement(TouchableOpacity, {
      style: [styles.btn, { backgroundColor: newId.trim() ? (c.BRAND_NEW || "#5865f2") : (c.BACKGROUND_TERTIARY || "#1e1f22") }],
      onPress: handleAdd,
    }, React.createElement(Text, { style: [styles.btnText, { color: newId.trim() ? "#fff" : (c.TEXT_MUTED || "#aaa") }] }, "Add User")),

    React.createElement(Text, { style: [styles.sectionTitle, { color: c.TEXT_NORMAL || "#fff", marginTop: 24 }] },
      "Watched Users (" + userKeys.length + ")"
    ),
    userKeys.length === 0
      ? React.createElement(Text, { style: [styles.emptyText, { color: c.TEXT_MUTED || "#aaa" }] }, "No users added yet")
      : userKeys.map(function(uid) {
          return React.createElement(UserCard, {
            key: uid + tick,
            userId: uid,
            config: storage.users[uid],
            onToggle: handleToggle,
            onDelete: handleDelete,
            onEditEmojis: handleEditEmojis,
          });
        })
  );
}

var plugin = {
  start: function() {
    interceptFn = function(payload) {
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
  stop: function() {
    if (interceptFn) {
      FD._interceptors = FD._interceptors.filter(function(f) { return f !== interceptFn; });
      interceptFn = null;
    }
  },
  SettingsComponent: SettingsComponent,
};
