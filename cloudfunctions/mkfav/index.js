const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
exports.main = async function () {
var db = cloud.database();
var out = {};
var names = ['spots', 'favorites'];
for (var i = 0; i < names.length; i++) {
var n = names[i];
try { await db.createCollection(n); out[n] = 'created'; } catch (e) { out[n] = 'exists'; }
}
return { ok: true, data: out };
};
