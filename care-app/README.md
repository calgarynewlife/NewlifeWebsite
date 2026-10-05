*[English version below ↓](#care--visitation-system--web-firebase)*

# 关怀探访系统 · 网页版（Firebase）

网页应用：**Firebase Authentication（登录）+ Firestore（数据库）+ 角色权限 + 审批**，
前端托管在 GitHub Pages。**全部免费，且 Firebase 免费版不会像 Supabase 那样自动暂停。**

## 角色权限

| 角色 | 能做什么 |
|---|---|
| **管理员 admin** | 全部：管用户/角色/审批、管小组、看改所有访客 |
| **负责人 leader** | 看改所有访客、登记、分配、接手未跟进 |
| **同工 volunteer** | 只看**分配给自己**的访客、填反馈、+1来访 |

权限在 **Firestore 安全规则**（`firestore.rules`）里强制——同工即使打开开发者工具也拿不到别人的数据。
新注册用户默认**未批准**，需管理员在「用户管理」页批准后才能使用。

## 安装步骤

### 1. 建 Firebase 项目
1. 打开 https://console.firebase.google.com → 「添加项目」，起个名（如 newlife-care）
   - Google Analytics 可以关掉，不需要
2. 项目建好后，点左侧 **构建 → Authentication → 开始使用 → 选「电子邮件/密码」→ 启用 → 保存**
3. 点左侧 **构建 → Firestore Database → 创建数据库 →** 选「**以生产模式启动**」→ 地区选离你近的（如 nam5 或 asia）→ 启用

### 2. 发布安全规则
- Firestore Database → **规则** 标签 → 把本目录 `firestore.rules` 全部粘贴 → **发布**

### 3. 注册一个 Web 应用，拿到配置
- 项目设置 ⚙（左上）→ **常规** → 下拉到「你的应用」→ 点 **`</>`（Web）** 图标 → 起个昵称 → 注册
- 会显示一段 `firebaseConfig = { apiKey: ..., authDomain: ..., ... }`
- 把这些字段填进本目录 `config.js`（这些值可公开，安全由规则保证）

### 4. 部署前端（GitHub Pages）
- 本 `care-app` 目录已在仓库里，推送后通过
  `https://michaelgniu.github.io/NewlifeWebsite/care-app/` 访问

### 5. 建第一个管理员
1. 打开上面的网址 → 「注册」→ 用你的邮箱注册（Firebase 默认不需要邮箱验证，注册即登录）
2. 你会看到「等待批准」页面——这是正常的
3. 回 Firebase 控制台 → **Firestore Database → 数据** → 打开 `profiles` 集合 → 找到你那条文档
   - 把 `role` 改为 `admin`
   - 把 `approved` 改为 `true`（布尔值）
4. 刷新网页，你就是管理员了，可在「用户管理」批准其他同工并设角色

### 6.（可选）自定义密码重置邮件的显示名
- Authentication → **Templates（模板）→ 密码重置** 可改中文措辞和发件名
- 密码重置用 Firebase 自带页面，无需额外配置

## 日常使用

- **负责人**在「登记新朋友」登记，并可分配同工（或留空等第二阶段自动分配）
- **同工**登录看「我的待办」→ 联系后「填反馈」
- **负责人**在「探访看板」一眼看到每个人的状态
- **忘记密码**：登录页点「忘记密码？」→ 收邮件 → 按 Firebase 页面设新密码

## 数据结构（Firestore 集合）

- `profiles/{uid}`：name, email, role, area, active, approved
- `visitors/{id}`：name, phone, email, area, identity, firstVisit, visitCount, status,
  assigneeId, assigneeName, assignDate, lastResult, lastContactDate, escalated, note
- `followups/{id}`：visitorId, byId, byName, result, encouraged, note, createdAt
- `groups/{id}`：name, coverArea, leaderName, leaderEmail, meetTime

## 第二阶段：自动任务（已实现）

周三自动分配、周五升级提醒、来访达标安排小组/福音群、四周失联判断，以及 Gmail 邮件通知。
用 **GitHub Actions 定时任务**（免费、不暂停）通过 Firebase 服务账号访问 Firestore 并发邮件。
代码见 `automation/`，工作流见仓库根目录 `.github/workflows/care-automation.yml`。

### 设置步骤

1. **在网页「设置」页填写**（管理员登录后）：探访负责人邮箱、福音事工负责人邮箱、
   达标次数、失联周数、系统网址。保存后写入 Firestore `config/app`，自动任务会读取。

2. **拿 Firebase 服务账号密钥**：Firebase 控制台 → 项目设置 ⚙ → **服务账号** →
   「生成新的私钥」→ 下载一个 JSON 文件（**这是机密，不要放进仓库**）。

3. **准备 Gmail 发信**：用一个 Gmail 账号发提醒。该账号需开启两步验证，然后在
   Google 账号 → 安全性 → **应用专用密码** 生成一个 16 位密码。

4. **在 GitHub 仓库加 3 个 Secret**：仓库 → Settings → Secrets and variables →
   Actions → New repository secret，分别添加：
   - `FIREBASE_SERVICE_ACCOUNT`：第 2 步 JSON 文件的**全部内容**（整段粘贴）
   - `GMAIL_USER`：发信用的 Gmail 地址
   - `GMAIL_APP_PASSWORD`：第 3 步的 16 位应用专用密码

5. **测试**：仓库 → Actions → 「关怀探访自动任务」→ Run workflow，
   task 选 `assign`（测分配）、`escalate`（测升级）、`daily`（测达标/失联）或 `all`。
   看运行日志确认邮件发出。确认无误后，它每天会自动按星期运行。

### 运行时间

GitHub Actions 按 UTC 定时（每天 15:00 UTC，约卡加利上午 8–9 点）。脚本按
**America/Edmonton 本地星期**判断：**周三**分配、**周五**升级、**每天**检查达标与失联。
（夏令时会让触发时间在上午 8 点与 9 点间浮动一小时，不影响功能。）

## 隐私

访客个人信息存在你自己的 Firebase 项目里，**代码仓库不含任何个人数据**。
`config.js` 里的 Firebase 配置是公开安全的（设计如此），真正的安全由 `firestore.rules` 保证。

---

# Care & Visitation System · Web (Firebase)

A web app: **Firebase Authentication (login) + Firestore (database) + role-based access + approval**,
front-end hosted on GitHub Pages. **Completely free, and unlike Supabase the Firebase free tier does not auto-pause.**

## Roles & permissions

| Role | What they can do |
|---|---|
| **admin** | Everything: manage users/roles/approvals, manage groups, view & edit all visitors |
| **leader** | View & edit all visitors, register, assign, take over un-followed cases |
| **volunteer** | Only see visitors **assigned to them**, submit feedback, +1 visit count |

Permissions are enforced in the **Firestore security rules** (`firestore.rules`) — a volunteer cannot
reach anyone else's data even via browser dev tools. New sign-ups are **unapproved** by default and must
be approved by an admin on the "User Management" tab before they can use the app.

## Setup

### 1. Create a Firebase project
1. Open https://console.firebase.google.com → "Add project", give it a name (e.g. newlife-care)
   - Google Analytics can be turned off; not needed
2. Left menu **Build → Authentication → Get started → choose "Email/Password" → Enable → Save**
3. Left menu **Build → Firestore Database → Create database →** choose "**Start in production mode**"
   → pick a nearby region → Enable

### 2. Publish the security rules
- Firestore Database → **Rules** tab → paste the full contents of `firestore.rules` → **Publish**

### 3. Register a Web app and get the config
- Project settings ⚙ (top-left) → **General** → scroll to "Your apps" → click the **`</>` (Web)** icon
  → give it a nickname → Register
- It shows a `firebaseConfig = { apiKey: ..., authDomain: ..., ... }` snippet
- Copy those fields into `config.js` (these values are safe to be public; security comes from the rules)

### 4. Deploy the front-end (GitHub Pages)
- This `care-app` folder is already in the repo; after pushing it's reachable at
  `https://michaelgniu.github.io/NewlifeWebsite/care-app/`

### 5. Create the first admin
1. Open the URL above → "Register" → sign up with your email
   (Firebase does not require email verification by default — you're logged in right after signing up)
2. You'll see a "Waiting for approval" screen — that's expected
3. Back in the Firebase console → **Firestore Database → Data** → open the `profiles` collection →
   find your document
   - Change `role` to `admin`
   - Change `approved` to `true` (boolean)
4. Refresh the page — you're now the admin and can approve other volunteers and set their roles
   on the "User Management" tab

### 6. (Optional) Customize the password-reset email
- Authentication → **Templates → Password reset** lets you edit the wording and sender name
- Password reset uses Firebase's own built-in page; no extra configuration needed

## Daily use

- **Leaders** register newcomers on "Register", and may assign a volunteer (or leave blank for
  auto-assignment in Phase 2)
- **Volunteers** log in to see "My To-Do" → after contacting, submit "Feedback"
- **Leaders** see everyone's status at a glance on the "Board"
- **Forgot password**: on the login page click "Forgot password?" → get the email → set a new
  password on Firebase's page

## Data model (Firestore collections)

- `profiles/{uid}`: name, email, role, area, active, approved
- `visitors/{id}`: name, phone, email, area, identity, firstVisit, visitCount, status,
  assigneeId, assigneeName, assignDate, lastResult, lastContactDate, escalated, note
- `followups/{id}`: visitorId, byId, byName, result, encouraged, note, createdAt
- `groups/{id}`: name, coverArea, leaderName, leaderEmail, meetTime

## Phase 2: Automation (implemented)

Wednesday auto-assignment, Friday escalation reminders, group/gospel placement after the target
number of visits, lost-contact handling after 4 weeks, and Gmail email notifications. Driven by a
**GitHub Actions scheduled job** (free, never pauses) that accesses Firestore via a Firebase
service account and sends email. Code is in `automation/`; the workflow is
`.github/workflows/care-automation.yml` at the repo root.

### Setup

1. **Fill in the "Settings" tab** (as admin): care-leader email, gospel-ministry-leader email,
   target visit count, lost-contact weeks, and the app URL. Saved to Firestore `config/app`,
   which the automation reads.

2. **Get a Firebase service-account key**: Firebase console → Project settings ⚙ →
   **Service accounts** → "Generate new private key" → downloads a JSON file
   (**this is secret — never commit it**).

3. **Prepare a Gmail sender**: use a Gmail account to send reminders. Enable 2-step verification,
   then under Google Account → Security → **App passwords**, create a 16-char password.

4. **Add 3 GitHub secrets**: repo → Settings → Secrets and variables → Actions →
   New repository secret:
   - `FIREBASE_SERVICE_ACCOUNT`: the entire contents of the JSON from step 2
   - `GMAIL_USER`: the sending Gmail address
   - `GMAIL_APP_PASSWORD`: the 16-char app password from step 3

5. **Test**: repo → Actions → "关怀探访自动任务" → Run workflow, pick a task:
   `assign`, `escalate`, `daily`, or `all`. Check the run log to confirm emails went out.
   After that it runs automatically every day by weekday.

### Schedule

GitHub Actions runs on UTC (daily at 15:00 UTC, ~8–9 AM in Calgary). The script decides by the
**America/Edmonton local weekday**: **Wednesday** assign, **Friday** escalate, **daily**
milestone & lost-contact checks. (DST shifts the fire time between 8 and 9 AM; functionality is
unaffected.)

## Privacy

Visitor personal information lives in your own Firebase project — **the code repo contains no
personal data**. The Firebase config in `config.js` is safe to be public (by design); real
security is enforced by `firestore.rules`.
