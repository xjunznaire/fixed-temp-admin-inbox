import PostalMime from "postal-mime";

// These counters are isolate-local diagnostics, not global Cloudflare analytics.

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function randomHex(bytes = 16) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return [...data].map(x => x.toString(16).padStart(2, "0")).join("");
}

function allowedDomains(env) {
  return String(env.ALLOWED_DOMAINS || "whtstore.my.id,shirochan.my.id,kingxjunz.my.id")
    .split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

function cleanLocalPart(value) {
  return String(value || "").trim().toLowerCase();
}

// Human-readable random mailbox names instead of opaque hexadecimal strings.
const RANDOM_FIRST_NAMES = [
  "aditya","andika","arya","bima","dimas","farhan","fajar","galih","ilham","irfan",
  "kevin","maulana","naufal","putra","rafi","raka","rangga","rizky","surya","yusuf",
  "aisyah","amelia","annisa","aulia","citra","dinda","farah","intan","kartika","nabila",
  "nadia","natasya","putri","rani","ratna","safira","salsa","tiara","zahra","zaskia"
];
const RANDOM_LAST_NAMES = [
  "pratama","saputra","wijaya","permana","ramadhan","mahardika","kusuma","setiawan",
  "firmansyah","purnama","lestari","anggraini","permatasari","maulida","oktavia",
  "putri","hakim","fauzan","hidayat","wardana","azhari","nugraha","susanto","ananda"
];

function randomPersonName() {
  const first = RANDOM_FIRST_NAMES[crypto.getRandomValues(new Uint32Array(1))[0] % RANDOM_FIRST_NAMES.length];
  const last = RANDOM_LAST_NAMES[crypto.getRandomValues(new Uint32Array(1))[0] % RANDOM_LAST_NAMES.length];
  return `${first}${last}`;
}

function validLocalPart(value) {
  return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(value) &&
    !value.includes("..") && !value.startsWith(".") && !value.endsWith(".");
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = {
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "vary": "Origin"
  };
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const requestUrl = new URL(request.url);
      const allowedWebOrigins = String(env.ALLOWED_WEB_ORIGINS || "https://whtstore.my.id,https://www.whtstore.my.id")
        .split(",").map(value => value.trim()).filter(Boolean);
      const isSameOrigin = originUrl.origin === requestUrl.origin;
      const isConfiguredOrigin = allowedWebOrigins.includes(originUrl.origin);
      if (isSameOrigin || isConfiguredOrigin) headers["access-control-allow-origin"] = origin;
    } catch { /* Ignore malformed Origin headers. */ }
  }
  return headers;
}

function responseWithCors(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

async function parseBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function authenticateMailbox(env, address, token) {
  if (!address || !token) return null;
  return env.DB.prepare(
    "SELECT address, token, expires_at FROM mailboxes WHERE address = ? AND token = ? AND expires_at > ?"
  ).bind(address.toLowerCase(), token, Date.now()).first();
}

async function cleanupExpired(env) {
  const now = Date.now();
  await env.DB.prepare("DELETE FROM mailboxes WHERE expires_at <= ?").bind(now).run();
  await env.DB.prepare("DELETE FROM messages WHERE received_at < ?").bind(now - 7 * 24 * 60 * 60 * 1000).run();
}

async function createMailbox(request, env) {
  const body = await parseBody(request);
  const domain = String(body.domain || "").trim().toLowerCase();
  const mode = body.mode === "custom" ? "custom" : "random";
  const domains = allowedDomains(env);
  if (!domains.includes(domain)) return json({ error: "Domain is not allowed." }, 400);

  let local = "";
  if (mode === "custom") {
    local = cleanLocalPart(body.local);
    if (!validLocalPart(local)) {
      return json({ error: "Email username must be 1–64 characters using lowercase letters, numbers, dots, underscores, or hyphens." }, 400);
    }
  }

  // Client may choose only the supported expiration durations.
  const allowedTtlMinutes = [15, 60, 360, 720, 1440];
  const requestedTtl = Number(body.ttlMinutes);
  const ttlMinutes = allowedTtlMinutes.includes(requestedTtl)
    ? requestedTtl
    : Math.min(1440, Math.max(15, Number(env.MAIL_TTL_HOURS || 24) * 60));
  const expiresAt = Date.now() + ttlMinutes * 60 * 1000;
  const ttlHours = ttlMinutes / 60;

  for (let attempt = 0; attempt < 5; attempt++) {
    const localPart = mode === "custom" ? local : randomPersonName();
    const address = `${localPart}@${domain}`;
    const token = randomHex(24);
    try {
      await env.DB.prepare(
        "INSERT INTO mailboxes (address, token, created_at, expires_at) VALUES (?, ?, ?, ?)"
      ).bind(address, token, Date.now(), expiresAt).run();
      await recordHistory(env, address, "mailbox_created", "visitor", "Mailbox dibuat");
      return json({ address, token, expiresAt, ttlHours, ttlMinutes });
    } catch (error) {
      if (mode === "custom") return json({ error: "Address is already in use. Choose another username." }, 409);
    }
  }
  return json({ error: "Could not create address. Please try again." }, 500);
}

async function listMessages(request, env, address) {
  const url = new URL(request.url);
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || url.searchParams.get("token");
  const mailbox = await authenticateMailbox(env, address, token);
  if (!mailbox) return json({ error: "Inbox tidak ditemukan, token salah, atau alamat sudah kedaluwarsa." }, 401);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const result = await env.DB.prepare(
    "SELECT id, to_address, from_address, subject, text_body, html_body, received_at FROM messages WHERE to_address = ? ORDER BY received_at DESC LIMIT ?"
  ).bind(address.toLowerCase(), limit).all();
  await recordHistory(env, address, "inbox_check", "visitor", `Inbox diperiksa; ${result.results?.length || 0} pesan`);
  return json({ address: mailbox.address, expiresAt: mailbox.expires_at, messages: result.results || [] });
}

async function getMessage(request, env, address, id) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const mailbox = await authenticateMailbox(env, address, token);
  if (!mailbox) return json({ error: "Inbox tidak ditemukan atau token salah." }, 401);
  const message = await env.DB.prepare(
    "SELECT id, to_address, from_address, subject, text_body, html_body, received_at FROM messages WHERE to_address = ? AND id = ?"
  ).bind(address.toLowerCase(), id).first();
  if (message) await recordHistory(env, address, "message_view", "visitor", `Membuka pesan ${id}`);
  return message ? json({ message }) : json({ error: "Pesan tidak ditemukan." }, 404);
}

async function deleteMailbox(request, env, address) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const mailbox = await authenticateMailbox(env, address, token);
  if (!mailbox) return json({ error: "Inbox tidak ditemukan atau token salah." }, 401);
  await recordHistory(env, address, "mailbox_deleted", "visitor", "Mailbox dihapus pemilik");
  await env.DB.prepare("DELETE FROM mailboxes WHERE address = ?").bind(address.toLowerCase()).run();
  return json({ ok: true });
}


const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000 }, key, 256);
  return bytesToHex(bits);
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function ensureCoreSchema(env) {
  // Keep the Worker usable when D1 was created but schema.sql was never applied.
  // CREATE IF NOT EXISTS preserves existing mailbox and message data.
  const statements = [
    `CREATE TABLE IF NOT EXISTS mailboxes (
      address TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      to_address TEXT NOT NULL,
      from_address TEXT,
      subject TEXT,
      text_body TEXT,
      html_body TEXT,
      received_at INTEGER NOT NULL,
      FOREIGN KEY (to_address) REFERENCES mailboxes(address) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_to_received ON messages(to_address, received_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mailboxes_expiry ON mailboxes(expires_at)`
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
}

async function ensureAdminSchema(env) {
  // Create admin-only tables lazily so login also works when the original
  // mailbox database was deployed before the admin migration was applied.
  const statements = [
    `CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      last_login_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at)`,
    `CREATE TABLE IF NOT EXISTS inbox_history (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      event TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'visitor',
      detail TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_history_created ON inbox_history(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_history_address ON inbox_history(address, created_at DESC)`
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();

  // Migrate databases created by older dashboard versions without replacing
  // existing accounts or their password hashes.
  const readColumnNames = async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(admin_users)").all();
    return new Set((columns.results || []).map(column => column.name));
  };
  let columnNames = await readColumnNames();
  for (const [name, sql] of [
    ["role", "ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'"],
    ["last_login_at", "ALTER TABLE admin_users ADD COLUMN last_login_at INTEGER"]
  ]) {
    if (!columnNames.has(name)) {
      try {
        await env.DB.prepare(sql).run();
      } catch (error) {
        // A concurrent first login may have completed this same migration.
        columnNames = await readColumnNames();
        if (!columnNames.has(name)) throw error;
      }
      columnNames.add(name);
    }
  }

  // Existing databases may still have a nullable email column from an earlier
  // release. New accounts are required to provide an email by API validation;
  // leave the legacy table in place so existing accounts and sessions remain safe.

  // Existing installations had no role concept. Make the oldest existing
  // account the initial owner so the installation does not become locked
  // out of owner-only account management after upgrading.
  const owner = await env.DB.prepare("SELECT id FROM admin_users WHERE role = 'owner' LIMIT 1").first();
  if (!owner) {
    await env.DB.prepare("UPDATE admin_users SET role = 'owner' WHERE id = (SELECT id FROM admin_users ORDER BY created_at ASC, id ASC LIMIT 1)").run();
  }
}

async function ensureBootstrapAdmin(env) {
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM admin_users").first();
  if (Number(count?.count || 0) === 0) {
    const salt = randomHex(16);
    const hash = await passwordHash("admin", salt);
    try {
      await env.DB.prepare("INSERT INTO admin_users (id, login, email, password_hash, salt, created_at, role) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(randomHex(16), "whitehostingid", "whitehostingid@whtstore.my.id", hash, salt, Date.now(), "owner").run();
    } catch (error) {
      // Another first request may have created the bootstrap account concurrently.
      const existing = await env.DB.prepare("SELECT id FROM admin_users LIMIT 1").first();
      if (!existing) throw error;
    }
  }
}

function bearerToken(request) {
  return request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
}

async function authenticateAdmin(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const session = await env.DB.prepare(
    "SELECT s.user_id, u.login, u.email, u.role FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(tokenHash, now).first();
  return session || null;
}

async function requireAdmin(request, env) {
  const admin = await authenticateAdmin(request, env);
  return admin;
}

async function recordHistory(env, address, event, actor = "visitor", detail = "") {
  try {
    await env.DB.prepare("INSERT INTO inbox_history (id, address, event, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(randomHex(16), String(address || "").toLowerCase(), event, actor, String(detail).slice(0, 300), Date.now()).run();
  } catch (error) { console.error("History write failed:", error); }
}

async function adminLogin(request, env) {
  await ensureCoreSchema(env);
  await ensureAdminSchema(env);
  await ensureBootstrapAdmin(env);
  const body = await parseBody(request);
  const login = String(body.login || body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!login || !password || password.length > 256) return json({ error: "Masukkan username/email dan password." }, 400);
  const user = await env.DB.prepare("SELECT id, login, email, password_hash, salt, role FROM admin_users WHERE lower(login) = ? OR lower(email) = ? LIMIT 1")
    .bind(login, login).first();
  if (!user) return json({ error: "Login atau password salah." }, 401);
  const candidate = await passwordHash(password, user.salt);
  if (!constantTimeEqual(candidate, user.password_hash)) return json({ error: "Login atau password salah." }, 401);
  const token = randomHex(32);
  const now = Date.now();
  await env.DB.prepare("UPDATE admin_users SET last_login_at = ? WHERE id = ?").bind(now, user.id).run();
  await env.DB.prepare("INSERT INTO admin_sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(randomHex(16), user.id, await sha256(token), now, now + ADMIN_SESSION_MS).run();
  await recordHistory(env, "SYSTEM", "admin_login", user.login, `Login berhasil (${user.role})`);
  return json({ token, expiresAt: now + ADMIN_SESSION_MS, user: { id: user.id, login: user.login, email: user.email, role: user.role, last_login_at: now } });
}


async function adminApi(request, env, path) {
  if (path === "/api/admin/login" && request.method === "POST") return adminLogin(request, env);
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: "Sesi admin tidak valid atau sudah berakhir. Silakan login kembali." }, 401);


  if (path === "/api/admin/me" && request.method === "GET") {
    return json({ user: { id: admin.user_id, login: admin.login, email: admin.email, role: admin.role } });
  }
  if (path === "/api/admin/logout" && request.method === "POST") {
    const token = bearerToken(request);
    await recordHistory(env, "SYSTEM", "admin_logout", admin.login, "Logout berhasil");
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ ok: true });
  }
  if (path === "/api/admin/stats" && request.method === "GET") {
    const now = Date.now();
    const jakartaParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(now));
    const dateParts = Object.fromEntries(jakartaParts.map(part => [part.type, part.value]));
    const todayKey = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    const todayStart = Date.parse(`${todayKey}T00:00:00+07:00`);
    const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
    const dailyGroupSql = (table, timestampColumn) =>
      `SELECT strftime('%Y-%m-%d', ${timestampColumn} / 1000, 'unixepoch', '+7 hours') AS day, COUNT(*) AS count FROM ${table} WHERE ${timestampColumn} >= ? GROUP BY day ORDER BY day ASC`;
    const [total, active, messages, users, admins, owners, history, dailyMailboxes, dailyMessages, dailyHistory] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM mailboxes").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM mailboxes WHERE expires_at > ?").bind(now).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM messages").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM admin_users").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM admin_users WHERE role = 'admin'").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM admin_users WHERE role = 'owner'").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM inbox_history").first(),
      env.DB.prepare(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', '+7 hours') AS day, COUNT(*) AS count FROM inbox_history WHERE event = 'mailbox_created' AND created_at >= ? GROUP BY day ORDER BY day ASC`).bind(weekStart).all(),
      env.DB.prepare(dailyGroupSql("messages", "received_at")).bind(weekStart).all(),
      env.DB.prepare(dailyGroupSql("inbox_history", "created_at")).bind(weekStart).all()
    ]);
    const countByDay = result => new Map((result.results || []).map(row => [row.day, Number(row.count) || 0]));
    const mailboxCounts = countByDay(dailyMailboxes);
    const messageCounts = countByDay(dailyMessages);
    const historyCounts = countByDay(dailyHistory);
    const dailyTrend = Array.from({ length: 7 }, (_, index) => {
      const dayTimestamp = weekStart + index * 24 * 60 * 60 * 1000;
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(new Date(dayTimestamp));
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      const day = `${values.year}-${values.month}-${values.day}`;
      return { day, mailboxes: mailboxCounts.get(day) || 0, messages: messageCounts.get(day) || 0, activity: historyCounts.get(day) || 0 };
    });
    const today = dailyTrend[dailyTrend.length - 1] || { mailboxes: 0, messages: 0, activity: 0 };
    return json({
      totalMailboxes: Number(total.count) || 0,
      activeMailboxes: Number(active.count) || 0,
      totalMessages: Number(messages.count) || 0,
      adminUsers: Number(users.count) || 0,
      adminRoleCount: Number(admins.count) || 0,
      ownerUsers: Number(owners.count) || 0,
      historyEvents: Number(history.count) || 0,
      todayMailboxes: today.mailboxes,
      todayMessages: today.messages,
      todayHistory: today.activity,
      dailyTrend
    });
  }
  if (path === "/api/admin/cleaner/preview" && request.method === "GET") {
    const now = Date.now();
    const messageCutoff = now - 7 * 24 * 60 * 60 * 1000;
    const [expiredMailboxes, expiredMailboxMessages, oldMessages, orphanMessages, expiredSessions] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM mailboxes WHERE expires_at <= ?").bind(now).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM messages m WHERE EXISTS (SELECT 1 FROM mailboxes b WHERE b.address = m.to_address AND b.expires_at <= ?)").bind(now).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM messages m WHERE m.received_at < ? AND EXISTS (SELECT 1 FROM mailboxes b WHERE b.address = m.to_address AND b.expires_at > ?)").bind(messageCutoff, now).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM messages m WHERE NOT EXISTS (SELECT 1 FROM mailboxes b WHERE b.address = m.to_address)").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM admin_sessions WHERE expires_at <= ?").bind(now).first()
    ]);
    const counts = {
      expiredMailboxes: Number(expiredMailboxes?.count) || 0,
      expiredMailboxMessages: Number(expiredMailboxMessages?.count) || 0,
      oldMessages: Number(oldMessages?.count) || 0,
      orphanMessages: Number(orphanMessages?.count) || 0,
      expiredSessions: Number(expiredSessions?.count) || 0
    };
    return json({
      scannedAt: now,
      messageRetentionDays: 7,
      counts,
      totalMessages: counts.expiredMailboxMessages + counts.oldMessages + counts.orphanMessages,
      totalItems: counts.expiredMailboxes + counts.expiredMailboxMessages + counts.oldMessages + counts.orphanMessages + counts.expiredSessions,
      canRun: admin.role === "owner",
      auditHistoryPreserved: true
    });
  }
  if (path === "/api/admin/cleaner/run" && request.method === "POST") {
    if (admin.role !== "owner") return json({ error: "Akses ditolak. Database Cleaner hanya dapat dijalankan oleh owner." }, 403);
    const now = Date.now();
    const messageCutoff = now - 7 * 24 * 60 * 60 * 1000;
    const results = await env.DB.batch([
      env.DB.prepare("DELETE FROM messages WHERE NOT EXISTS (SELECT 1 FROM mailboxes b WHERE b.address = messages.to_address)"),
      env.DB.prepare("DELETE FROM messages WHERE to_address IN (SELECT address FROM mailboxes WHERE expires_at <= ?)").bind(now),
      env.DB.prepare("DELETE FROM messages WHERE received_at < ?").bind(messageCutoff),
      env.DB.prepare("DELETE FROM mailboxes WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now)
    ]);
    const changes = (results || []).map(result => Number(result?.meta?.changes) || 0);
    const cleaned = {
      orphanMessages: changes[0] || 0,
      expiredMailboxMessages: changes[1] || 0,
      oldMessages: changes[2] || 0,
      expiredMailboxes: changes[3] || 0,
      expiredSessions: changes[4] || 0
    };
    const total = Object.values(cleaned).reduce((sum, value) => sum + value, 0);
    await recordHistory(env, "SYSTEM", "database_cleaner_run", admin.login, `Cleaner selesai: ${total} item dihapus; riwayat audit dipertahankan`);
    return json({ ok: true, cleaned, total, finishedAt: Date.now(), auditHistoryPreserved: true });
  }
  if (path === "/api/admin/console" && request.method === "GET") {
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 120)));
    const search = String(url.searchParams.get("search") || "").trim().toLowerCase().slice(0, 100);
    const pattern = `%${search}%`;
    const rows = await env.DB.prepare(`SELECT id, address, event, actor, detail, created_at
      FROM inbox_history
      WHERE lower(event || ' ' || actor || ' ' || address || ' ' || detail) LIKE ?
      ORDER BY created_at DESC LIMIT ?`).bind(pattern, limit).all();
    return json({ logs: rows.results || [], source: "inbox_history", generatedAt: Date.now() });
  }
  if (path === "/api/admin/mailboxes" && request.method === "GET") {
    const url = new URL(request.url);
    const search = `%${String(url.searchParams.get("search") || "").trim().toLowerCase().slice(0, 100)}%`;
    const rows = await env.DB.prepare(`SELECT m.address, m.created_at, m.expires_at,
      (SELECT COUNT(*) FROM messages x WHERE x.to_address = m.address) AS message_count
      FROM mailboxes m WHERE lower(m.address) LIKE ? ORDER BY m.created_at DESC LIMIT 200`).bind(search).all();
    return json({ mailboxes: rows.results || [] });
  }
  if (path === "/api/admin/history" && request.method === "GET") {
    const limit = Math.min(300, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 150)));
    const rows = await env.DB.prepare("SELECT id, address, event, actor, detail, created_at FROM inbox_history ORDER BY created_at DESC LIMIT ?").bind(limit).all();
    return json({ history: rows.results || [] });
  }
  if (path === "/api/admin/users" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, login, email, role, last_login_at, created_at FROM admin_users ORDER BY created_at DESC").all();
    return json({ users: rows.results || [] });
  }
  if (path === "/api/admin/users" && request.method === "POST") {
    const body = await parseBody(request);
    const emailInput = String(body.email || "").trim().toLowerCase();
    const email = emailInput;
    const usernameInput = String(body.username || "").trim().toLowerCase();
    // Username is optional. When it is blank, the email is also used as the
    // account's login identifier so the existing login flow keeps working.
    const login = usernameInput || emailInput;
    const role = String(body.role || "admin").trim().toLowerCase();
    const password = String(body.password || "");
    if (!emailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
      return json({ error: "Email wajib diisi dengan format yang valid." }, 400);
    }
    if (usernameInput && !/^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])$/.test(usernameInput)) {
      return json({ error: "Username opsional. Jika diisi, gunakan 2–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip." }, 400);
    }
    if (!["admin", "owner"].includes(role)) return json({ error: "Role harus admin atau owner." }, 400);
    if (role === "owner" && admin.role !== "owner") return json({ error: "Hanya owner yang dapat membuat akun dengan role owner." }, 403);
    if (password.length < 4 || password.length > 256) return json({ error: "Password minimal 4 karakter dan maksimal 256 karakter." }, 400);
    // Check each supplied identifier against BOTH columns. This prevents a
    // username from colliding with another account's email (or vice versa),
    // while avoiding comparisons against an empty optional username.
    const duplicate = await env.DB.prepare(
      "SELECT id FROM admin_users WHERE lower(email) = ? OR lower(login) = ? OR (? <> '' AND (lower(email) = ? OR lower(login) = ?)) LIMIT 1"
    ).bind(emailInput, emailInput, usernameInput, usernameInput, usernameInput).first();
    if (duplicate) return json({ error: "Email atau username sudah digunakan oleh akun admin lain." }, 409);
    const salt = randomHex(16);
    const hash = await passwordHash(password, salt);
    try {
      await env.DB.prepare("INSERT INTO admin_users (id, login, email, password_hash, salt, created_at, role) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(randomHex(16), login, email, hash, salt, Date.now(), role).run();
    } catch (error) {
      // A concurrent request may have claimed the same unique identifier.
      const duplicateAfterInsert = await env.DB.prepare(
        "SELECT id FROM admin_users WHERE lower(email) = ? OR lower(login) = ? OR (? <> '' AND (lower(email) = ? OR lower(login) = ?)) LIMIT 1"
      ).bind(emailInput, emailInput, usernameInput, usernameInput, usernameInput).first();
      if (duplicateAfterInsert) return json({ error: "Email atau username sudah digunakan oleh akun admin lain." }, 409);
      console.error("Admin account creation failed:", error);
      return json({ error: "Akun admin gagal dibuat. Silakan coba lagi." }, 500);
    }
    return json({ ok: true });
  }

  const userDelete = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userDelete && request.method === "DELETE") {
    const id = decodeURIComponent(userDelete[1]);
    if (admin.role !== "owner") return json({ error: "Akses ditolak. Hanya owner yang dapat menghapus akun admin." }, 403);
    if (id === admin.user_id) return json({ error: "Anda tidak dapat menghapus akun yang sedang digunakan." }, 400);
    const target = await env.DB.prepare("SELECT id, role FROM admin_users WHERE id = ?").bind(id).first();
    if (!target) return json({ error: "Akun admin tidak ditemukan." }, 404);
    if (target.role !== "admin") return json({ error: "Owner hanya dapat menghapus akun dengan role admin." }, 403);
    await env.DB.prepare("DELETE FROM admin_users WHERE id = ? AND role = 'admin'").bind(id).run();
    return json({ ok: true });
  }

  const mailboxMessages = path.match(/^\/api\/admin\/mailboxes\/(.+)\/messages$/);
  if (mailboxMessages && request.method === "GET") {
    const address = decodeURIComponent(mailboxMessages[1]).toLowerCase();
    const rows = await env.DB.prepare("SELECT id, to_address, from_address, subject, text_body, html_body, received_at FROM messages WHERE to_address = ? ORDER BY received_at DESC LIMIT 100").bind(address).all();
    await recordHistory(env, address, "admin_view_inbox", admin.login, "Admin membuka daftar pesan");
    return json({ messages: rows.results || [] });
  }
  const mailboxDetail = path.match(/^\/api\/admin\/mailboxes\/(.+)$/);
  if (mailboxDetail && request.method === "GET") {
    const address = decodeURIComponent(mailboxDetail[1]).toLowerCase();
    const mailbox = await env.DB.prepare("SELECT address, created_at, expires_at FROM mailboxes WHERE address = ?").bind(address).first();
    if (!mailbox) return json({ error: "Mailbox tidak ditemukan." }, 404);
    await recordHistory(env, address, "admin_view_mailbox", admin.login, "Admin melihat detail mailbox");
    return json({ mailbox });
  }
  return json({ error: "Admin endpoint tidak ditemukan." }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const requestStartedAt = performance.now();
    if (request.method === "OPTIONS") {
      const response = responseWithCors(new Response(null, { status: 204 }), request, env);
      const elapsed = Math.max(0, performance.now() - requestStartedAt);
      return response;
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    let response;

    try {
      if (path.startsWith("/api/admin/")) {
        response = await adminApi(request, env, path);
      } else if (path === "/admin") {
        const adminHome = new URL("/admin/", request.url);
        response = await env.ASSETS.fetch(new Request(adminHome, request));
      } else if (path === "/api/health") {
        response = json({ ok: true, brand: "White Hosting ID", domains: allowedDomains(env) });
      } else if (path === "/api/domains" && request.method === "GET") {
        response = json({ domains: allowedDomains(env) });
      } else if (path === "/api/mailboxes" && request.method === "POST") {
        await cleanupExpired(env);
        response = await createMailbox(request, env);
      } else if (path.startsWith("/api/inbox/") && request.method === "GET") {
        const address = decodeURIComponent(path.slice("/api/inbox/".length));
        response = await listMessages(request, env, address);
      } else if (path.startsWith("/api/message/") && request.method === "GET") {
        const rest = path.slice("/api/message/".length);
        const slash = rest.lastIndexOf("/");
        if (slash < 1) response = json({ error: "Path pesan tidak valid." }, 400);
        else response = await getMessage(request, env, decodeURIComponent(rest.slice(0, slash)), decodeURIComponent(rest.slice(slash + 1)));
      } else if (path.startsWith("/api/mailboxes/") && request.method === "DELETE") {
        response = await deleteMailbox(request, env, decodeURIComponent(path.slice("/api/mailboxes/".length)));
      } else if (path === "/inbox" || path.startsWith("/inbox/")) {
        // Serve the dedicated inbox page for /inbox and shareable /inbox/<address> URLs.
        const inboxHome = new URL("/inbox/", request.url);
        response = await env.ASSETS.fetch(new Request(inboxHome, request));
      } else {
        response = await env.ASSETS.fetch(request);
      }
    } catch (error) {
      console.error("Request failed:", error);
      response = json({ error: "An internal server error occurred." }, 500);
    }
    const finalResponse = responseWithCors(response, request, env);
    const elapsed = Math.max(0, performance.now() - requestStartedAt);
    return finalResponse;
  },

  async email(message, env, ctx) {
    try {
      const recipient = String(message.to || "").trim().toLowerCase();
      const mailbox = await env.DB.prepare(
        "SELECT address FROM mailboxes WHERE address = ? AND expires_at > ?"
      ).bind(recipient, Date.now()).first();
      if (!mailbox) {
        message.setReject("Temporary mailbox does not exist or has expired.");
        return;
      }

      const parsed = await PostalMime.parse(message.raw);
      const id = randomHex(16);
      const from = parsed.from?.address || String(message.from || "unknown");
      const subject = String(parsed.subject || "(No subject)").slice(0, 500);
      const textBody = String(parsed.text || "").slice(0, 100000);
      const htmlBody = String(parsed.html || "").slice(0, 150000);
      const maxMessages = Math.min(100, Math.max(1, Number(env.MAX_MESSAGES_PER_INBOX || 50)));

      await env.DB.prepare(
        "INSERT INTO messages (id, to_address, from_address, subject, text_body, html_body, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(id, recipient, from, subject, textBody, htmlBody, Date.now()).run();

      await env.DB.prepare(
        "DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE to_address = ? ORDER BY received_at DESC LIMIT -1 OFFSET ?)"
      ).bind(recipient, maxMessages).run();
    } catch (error) {
      console.error("Email handler failed:", error);
      message.setReject("Message could not be processed.");
    }
  }
};
