# White Hosting ID Temporary Mail

A Cloudflare Workers + D1 disposable inbox project with a static frontend, custom/random addresses, three configurable domains, EN/ID interface, inbox scrolling, message parsing, and an SVG favicon.

## Important notes

- This source does not add Cloudflare credits or a Cloudflare badge to the UI.
- It uses Cloudflare Workers, D1, and Email Routing. Free plan limits and availability can change; check your Cloudflare dashboard before production use.
- Receiving email requires each domain to be active on Cloudflare Email Routing and the catch-all/routing rule to point to this Worker. Merely adding a domain to the dropdown does not configure inbound mail.
- The app stores inbox messages in D1. Each mailbox can expire after 15 minutes, 1 hour, 6 hours, 12 hours, or 24 hours (24 hours is the default). The interface defaults to English; Indonesian is available with the language toggle. Run a scheduled cleanup or rely on cleanup during mailbox creation; messages may contain private information.
- Temporary email should not be used for banking, identity verification, password recovery, or other sensitive accounts.

## 1. Prerequisites

1. The three email domains must be active in the same Cloudflare account, with DNS managed by Cloudflare.
2. The website domain `whtstore.my.id` must be active in Cloudflare.
3. This project is intended to deploy through GitHub-connected Cloudflare Workers Builds; no local terminal or VPS is required.



## 2. Create D1 database

Create a new D1 database named `fixed-temp-admin-inbox` from Cloudflare Dashboard. Copy its database ID into `wrangler.toml`, replacing `PASTE_NEW_D1_DATABASE_ID_HERE`. Then open the D1 Console and execute the complete contents of `schema.sql`.

## 3. Deploy through GitHub and Cloudflare

Upload the project contents to GitHub and connect the repository from the existing Worker under Settings > Builds. Use root directory `/`, leave Build command empty, and use Deploy command `npx wrangler deploy`. The `ASSETS` binding serves the `public/` frontend and the same Worker handles `/api/*` plus inbound `email()` events.

## 5. Connect the custom website domain

In Cloudflare Dashboard:
1. Go to Workers & Pages → `fixed-temp-admin-inbox`.
2. Open Settings / Domains & Routes (wording may vary).
3. Add the website custom domain `whtstore.my.id` to this Worker.
4. Keep the website custom domain separate from the three email domains.

Do not add a CNAME to the Worker manually if Cloudflare's Custom Domains flow asks to manage DNS automatically.

## 6. Enable inbound email for each email domain

Repeat for `whtstore.my.id`, `shirochan.my.id`, and `kingxjunz.my.id`:

1. Open Email Routing for the domain and enable it.
2. Allow Cloudflare to add the required MX and SPF records. Do not replace unrelated mail records without checking them first.
3. Create a catch-all rule that routes incoming addresses to the deployed Worker `fixed-temp-admin-inbox`.
4. Confirm that the route points to the Worker and that the Worker has its D1 binding configured.
5. Send a test message from a different email account to an address created by the site.

Cloudflare Email Routing must support routing to an email Worker for the account/domain. If the dashboard does not offer the Worker as a destination, verify the domain zone, Email Routing setup, and current Cloudflare plan/product availability.

## 7. Domain and address examples

- `tes@whtstore.my.id`
- `halo@shirochan.my.id`
- `x7k29p@kingxjunz.my.id`

The requested example `tes.whtstore.my.id` is a subdomain host, not an email address. For email delivery, use `tes@whtstore.my.id`. If you specifically want `tes@tes.whtstore.my.id`, you must create and configure the `tes.whtstore.my.id` DNS zone/subdomain for email routing too; this project does not create DNS records automatically.

## 8. Cloudflare-only dashboard option

If you do not want to use a local terminal, use GitHub-connected Workers Builds:
1. Upload the complete repository contents to GitHub (the files and folders, not the ZIP itself).
2. In Cloudflare, open Workers & Pages and create/connect a Worker using the GitHub repository.
3. Set the build/deploy command to `npx wrangler deploy`; install command `npm ci` (if the dashboard asks for one).
4. Keep `wrangler.toml`, `package.json`, `package-lock.json`, `src/`, and `public/` at the repository root.
5. Confirm the existing D1 binding named `DB` and static assets binding `ASSETS` are deployed from the config.
6. Add `whtstore.my.id` under the Worker Custom Domains screen.

Do not create a new D1 database if you need to preserve existing inboxes. Confirm that the database ID in `wrangler.toml` is the same database already used by your live Worker. The Worker now creates missing core/admin tables with `CREATE TABLE IF NOT EXISTS` on the first admin login; this does not delete existing rows.

The most reliable way to deploy this complete project is Wrangler; Cloudflare Pages direct upload does not support Pages Functions in the same way as a build/deploy workflow. This repository uses a single Worker with static assets and an email handler, so Workers is the recommended deployment target.

## API summary

- `GET /api/health`
- `GET /api/domains`
- `POST /api/mailboxes` with `{ "mode":"custom", "local":"tes", "domain":"whtstore.my.id" }`
- `GET /api/inbox/tes%40whtstore.my.id` with `Authorization: Bearer <token>`
- `GET /api/message/<address>/<message-id>` with bearer token
- `DELETE /api/mailboxes/<address>` with bearer token

## Files

- `src/index.js` — Worker API and inbound email handler
- `public/index.html` — site UI
- `public/style.css` — responsive dark UI and scrollable inbox
- `public/app.js` — create address, inbox, EN/ID switch
- `public/favicon.svg` — original favicon
- `schema.sql` — D1 tables/indexes
- `wrangler.toml` — deployment configuration


## 9. Reopen an existing inbox

The frontend now supports shareable inbox paths such as:

- `https://whtstore.my.id/inbox/tes%40whtstore.my.id`

After creating a mailbox, the app stores its recovery token in the current browser's `localStorage` and updates the URL to `/inbox/<encoded-email-address>`. Opening that URL again in the same browser restores the inbox automatically (as long as it has not expired).

To restore an inbox on another browser/device:
1. Enter the previously created email address in **Buka inbox lama**.
2. Enter the recovery token shown in the inbox panel when the mailbox was created.
3. Select **Buka inbox**.

Keep the recovery token private. Anyone with both the email address and its recovery token can read and delete that inbox. Clearing browser storage removes the saved token from that browser; it does not delete the mailbox, but you will need the recovery token to regain access.

The Worker serves the existing frontend application for `/inbox` and `/inbox/<address>` paths. The inbox data remains behind the existing authenticated API:

- `GET /api/inbox/<encoded-email-address>` — requires `Authorization: Bearer <recovery-token>`
- `DELETE /api/mailboxes/<encoded-email-address>` — requires the same bearer token

Kolom `role` dan `last_login_at` ditambahkan otomatis saat login admin pertama setelah pembaruan. Data akun lama dan password hash tetap dipertahankan; jika belum ada owner, akun admin tertua otomatis ditetapkan sebagai owner.

## Admin Dashboard

Dashboard admin tersedia di `https://whtstore.my.id/admin/`.

### Fitur
- Login admin dengan username atau email.
- Statistik dashboard: total temp mail, inbox aktif, total email masuk, aktivitas inbox, jumlah akun ber-role admin dan owner, statistik hari ini, serta grafik tren 7 hari terakhir (waktu Asia/Jakarta). Statistik dapat diperbarui manual dari tab Ringkasan.
- Daftar mailbox yang dibuat, status kedaluwarsa, jumlah pesan, dan preview isi pesan.
- Riwayat pembuatan mailbox, pemeriksaan inbox, pembukaan pesan, dan aktivitas admin.
- Membuat akun admin dengan email wajib, username opsional, password, dan role `admin` atau `owner`.
- Menampilkan role dan waktu terakhir login setiap akun admin.
- Tombol **Home** di sebelah **Keluar** kembali ke halaman awal aplikasi tanpa mengakhiri sesi admin.
- Hanya role `owner` yang dapat menghapus akun dengan role `admin`; tautan Hapus ditampilkan di bawah status Akun aktif. Akun owner dan akun yang sedang digunakan tidak dapat dihapus dari dashboard.
- Tombol **Database Cleaner** menyediakan scan/pratinjau data sebelum dibersihkan. Eksekusi hanya untuk owner; menghapus mailbox kedaluwarsa, email lama lebih dari 7 hari, email orphan, dan sesi admin kedaluwarsa. Riwayat audit tidak ikut dihapus.
- Tombol **Console** menampilkan log aktivitas aplikasi dari tabel audit dan melakukan refresh otomatis setiap 5 detik. Ini bukan terminal perintah Cloudflare atau pengganti `wrangler tail`.
- Email wajib dan unik. Username opsional; jika diisi harus unik. Login dapat menggunakan email atau username jika tersedia. Jika username dikosongkan, email digunakan sebagai login. Password minimal 4 karakter dan boleh berupa huruf kecil saja tanpa angka. Notifikasi akun berhasil dibuat menghilang otomatis setelah 5 detik.
- Sesi admin berlaku 12 jam; token sesi disimpan dalam bentuk hash di D1.
- Password akun di-hash menggunakan PBKDF2-HMAC-SHA-256 (120.000 iterasi) dengan salt acak.

### Inisialisasi database baru melalui Dashboard
Buat D1 baru bernama `fixed-temp-admin-inbox`, lalu jalankan seluruh isi `schema.sql` melalui D1 Console. Jangan jalankan perintah terminal. Pastikan database ID baru disalin ke `wrangler.toml` sebelum commit dan deployment.

Pastikan binding D1 `DB`, binding assets `ASSETS`, domain route, dan konfigurasi Email Routing yang lama tetap aktif.

### Login awal
Pada saat login admin pertama kali, Worker akan membuat akun bootstrap jika tabel `admin_users` masih kosong:

- Username: `whitehostingid`
- Password: `admin`
- Email akun: `whitehostingid@whtstore.my.id`

Segera buat akun admin baru dengan email wajib dan password kuat melalui menu **Admin Users**. Login awal memakai password sederhana sesuai permintaan, jadi jangan biarkan kredensial awal tersebar. Akun bootstrap tidak dibuat ulang jika sudah ada minimal satu akun admin.

### Catatan audit
Riwayat inbox mulai tercatat setelah versi dashboard ini dipasang dan migrasi database dijalankan. Aktivitas sebelum pemasangan tidak dapat direkonstruksi. Riwayat mencatat pembuatan mailbox, pemeriksaan daftar inbox, pembukaan pesan, penghapusan mailbox, dan pemeriksaan oleh admin. Dashboard menampilkan isi email dalam bentuk teks yang di-escape; HTML email tidak dieksekusi.


## Admin login recovery

The bootstrap account is created only if `admin_users` is empty: username `whitehostingid`, password `admin`. Change this password immediately after first login. If an admin account already exists, its password is not overwritten. The Worker initializes missing `mailboxes`, `messages`, and admin tables on the first login; existing D1 rows are retained.


## Quick action buttons

The address generator now has four peer actions in one responsive tab row:
**Custom address**, **Random address**, **Cek Inbox**, and **Admin Dashboard**.
`Cek Inbox` opens `/inbox`; the visitor enters an existing email address and its
recovery token, then the existing authenticated inbox flow navigates to
`/inbox/<encoded-address>` and displays the mailbox message history. The
`Admin Dashboard` link opens `/admin`.

Inbox messages remain protected by the existing recovery-token authentication.
A visitor cannot read another person's mailbox using only the email address;
the owner must provide the recovery token (or use the token already saved in
that browser). This preserves the backend's existing mailbox privacy model.


## Dedicated inbox page

`/inbox` now serves its own HTML document at `public/inbox/index.html`,
separate from the generator page, like the separate Admin Dashboard HTML.
The same dedicated page handles `/inbox/<encoded-address>` and preserves the
existing authenticated mailbox/history workflow. The inbox title marker uses
a numbered step instead of a refresh glyph, and the refresh/delete controls
are centered and spaced consistently.


## Inbox form visibility

The "Reopen an existing inbox" panel is hidden on the initial generator page.
Clicking **Cek Inbox** navigates to `/inbox`, where the separate inbox HTML page
shows the address and recovery-token form. The panel is therefore available
only in the dedicated inbox view, not on the home/generator screen.


## Admin dashboard navigation update (v8)

- The standalone Riwayat Inbox tab has been removed. Its full table now appears below the Console log with a Perbarui button and the Waktu, Alamat, Aktivitas, Actor, and Detail columns.
- The overview shortcut now opens Console.

## Admin Dashboard utilities

The Admin Dashboard now includes two tools beside Console:

- **A2F Authenticator**: RFC 6238 TOTP generator (6 digits, 30-second interval, HMAC-SHA1). The Base32 secret is processed locally in the browser using Web Crypto and is not sent to the Worker. Use HTTPS for Web Crypto support.
- **Address Generator**: region/country selector that reverse-geocodes random points near mapped city centres through Geoapify. The Worker only returns an address when the provider supplies a house number, street, city, postcode, matching country code, and a minimum confidence score. First/last names are randomly selected from country-specific name examples; they are not verified identities. A mapped address is not a guarantee of postal deliverability, residence, or permission to use it.
- Geoapify's Reverse Geocoding API converts coordinates into structured address components, including house number, street, city, postcode and country. See [Geoapify Reverse Geocoding documentation](https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/). OpenStreetMap attribution is displayed with generated results.

No new database tables or third-party npm dependencies are required. The Worker makes user-triggered provider requests using the configured API key.


### Address generator troubleshooting update
The Worker now returns actionable errors for Geoapify HTTP 401/403 (API key or restrictions), 429 (quota/rate limit), other provider errors, and no qualifying mapped building. It tries up to 24 reverse-geocoding points per click. A successful result still requires a matching country, house number, street, city, postcode, and confidence of at least 0.7.


Catatan versi ini: Address Generator dan integrasi Geoapify telah dihapus. A2F Authenticator tetap tersedia. Kolom Secret key (Base32) menampilkan teks yang diketik secara langsung; input diproses di browser dan tidak dikirim ke server.
