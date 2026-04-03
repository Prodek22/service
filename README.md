# GTA5 FiveM Service Automation

Aplicatie completa pentru automatizarea proceselor HR + pontaj de pe Discord (server roleplay GTA5/FiveM).

## Ce include

- `Node.js + Express` pentru API admin
- `discord.js v14` pentru ingestie automata din canale Discord
- `MySQL/MariaDB + Prisma` pentru persistenta
- `React + Vite` pentru panel web administrativ
- parser tolerant pentru CV-uri (sinonime, typo-uri, etichete variate)
- parser pentru evenimente de pontaj + cicluri saptamanale delimitate de reset real
- `messageCreate`, `messageUpdate`, `messageDelete`
- script de backfill paginat pentru istoricul canalelor

## Arhitectura

1. Botul Discord asculta canalele configurate.
2. Mesajele din canalul CV sunt parse-uite tolerant si upsert-uite in `employees`.
3. Mesajele din canalul pontaj sunt convertite in `time_events`.
4. Mesajele de reset creeaza un nou `week_cycle` si inchid ciclul anterior.
5. API-ul expune datele pentru UI (dashboard, CV-uri, pontaj, export CSV).
6. UI React afiseaza tabele, filtre, cautare, paginare, editare manuala.

## Structura proiectului

```text
.
├─ apps/
│  ├─ server/
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma
│  │  │  └─ migrations/0001_init/migration.sql
│  │  ├─ src/
│  │  │  ├─ bot/discordBot.ts
│  │  │  ├─ config/env.ts
│  │  │  ├─ db/prisma.ts
│  │  │  ├─ parsers/cvParser.ts
│  │  │  ├─ parsers/timesheetParser.ts
│  │  │  ├─ routes/
│  │  │  │  ├─ dashboardRoutes.ts
│  │  │  │  ├─ employeesRoutes.ts
│  │  │  │  ├─ healthRoutes.ts
│  │  │  │  └─ timesheetRoutes.ts
│  │  │  ├─ scripts/backfill.ts
│  │  │  ├─ services/
│  │  │  │  ├─ cvService.ts
│  │  │  │  ├─ employeeMatcher.ts
│  │  │  │  └─ timesheetService.ts
│  │  │  ├─ utils/
│  │  │  │  ├─ normalize.ts
│  │  │  │  └─ time.ts
│  │  │  ├─ app.ts
│  │  │  ├─ index.ts
│  │  │  └─ types.ts
│  │  ├─ .env.example
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  └─ web/
│     ├─ src/
│     │  ├─ api/client.ts
│     │  ├─ pages/DashboardPage.tsx
│     │  ├─ pages/EmployeesPage.tsx
│     │  ├─ pages/TimesheetPage.tsx
│     │  ├─ App.tsx
│     │  ├─ main.tsx
│     │  ├─ styles.css
│     │  ├─ types.ts
│     │  └─ vite-env.d.ts
│     ├─ .env.example
│     ├─ index.html
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ vite.config.ts
├─ package.json
└─ .gitignore
```

## Schema DB (Prisma)

Modele principale:

- `employees`
- `employee_cv_raw`
- `employee_aliases`
- `time_events`
- `week_cycles`

Enum-uri:

- `EmployeeStatus`: `ACTIVE`, `INCOMPLETE`, `DELETED`
- `ParseStatus`: `SUCCESS`, `PARTIAL`, `FAILED`
- `TimeEventType`: `CLOCK_IN`, `CLOCK_OUT`, `MANUAL_ADJUSTMENT`, `WEEKLY_RESET`, `UNKNOWN`

Detaliile complete sunt in:

- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/0001_init/migration.sql`

## Configurare `.env`

Copiaza `apps/server/.env.example` in `apps/server/.env` si completeaza:

```env
DISCORD_TOKEN=
DISCORD_GUILD_ID=
CV_CHANNEL_ID=
TIMESHEET_CHANNEL_ID=
EMPLOYEE_ROLE_ID=
EMPLOYEE_ROLE_NAME=Angajat
AUTH_JWT_SECRET=change_this_to_a_long_random_secret
CORS_ORIGIN=http://localhost:5173
AUTH_COOKIE_SECURE=true
DATABASE_URL="mysql://user:password@localhost:3306/service_admin"
PORT=3001
```

Optional frontend: `apps/web/.env.example` -> `apps/web/.env`

```env
VITE_API_BASE_URL=/api
```

## Instalare si rulare local

Din root:

```bash
npm install
```

Generare Prisma client:

```bash
npm run db:generate
```

Aplicare migrare in DB:

```bash
npm run db:migrate
```

Creeaza/actualizeaza user admin pentru login:

```bash
npm run admin:create -w @gta-service/server -- admin parola_foarte_puternica
```

Pornire dev (API + bot + web):

```bash
npm run dev
```

Build productie:

```bash
npm run build
```

Backfill istoric Discord:

```bash
npm run backfill
```

## Endpointuri API (exemple)

Health:

- `GET /api/health`

Auth:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Dashboard:

- `GET /api/dashboard`

Employees / CV:

- `GET /api/employees?page=1&pageSize=15&search=alex&status=INCOMPLETE&missingImage=true`
- `GET /api/employees/:id`
- `PATCH /api/employees/:id`
- `GET /api/employees/:id/raw`
- `GET /api/employees/:id/aliases`
- `POST /api/employees/:id/aliases`

Pontaj:

- `GET /api/timesheet/cycles`
- `GET /api/timesheet/summary?cycleId=4`
- `GET /api/timesheet/employee/:employeeId/history?cycleId=4`
- `GET /api/timesheet/export.csv?cycleId=4`

Maintenance (necesita login):

- `POST /api/maintenance/delete-old` (body: `{ "olderThanDays": 90 }`)
- `POST /api/maintenance/sync-new` (body: `{ "latestLimitPerChannel": 100 }`)

## Cum functioneaza parsarea CV

- normalizare text (`lowercase`, eliminare diacritice la comparatii, whitespace curat)
- mapare toleranta etichete (sinonime + typo comun)
- fallback regex pentru campuri esentiale
- pastreaza raw text + raw attachments in `employee_cv_raw`
- `messageUpdate` reprocezeaza si actualizeaza inregistrarea
- `messageDelete` marcheaza employee ca `DELETED` (soft delete)
- asociere ulterioara poza buletin daca vine ca reply la mesajul CV original
- upsert cu prioritate: `cv_message_id` -> `iban` -> (`full_name` + `nickname`)

## Cum functioneaza parsarea pontaj

Tipuri detectate:

- inceput pontaj -> `CLOCK_IN`
- incheiat pontaj -> `CLOCK_OUT`
- ajustare manuala +/- -> `MANUAL_ADJUSTMENT`
- reset saptamanal -> `WEEKLY_RESET`

Reguli:

- parse explicit semn numeric la minute/secunde
- suporta mention format `<@id>` si `@Nume - 140263`
- fiecare mesaj este eveniment separat in `time_events`
- resetul real creeaza un nou `week_cycle`
- totaluri calculate pe ciclu, cu separare timp normal vs ajustari

## Deploy pe VPS Ubuntu + Nginx

### 1. Pachete sistem

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nginx mysql-server
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. DB MySQL/MariaDB

```sql
CREATE DATABASE service_admin CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'service_user'@'localhost' IDENTIFIED BY 'parola_puternica';
GRANT ALL PRIVILEGES ON service_admin.* TO 'service_user'@'localhost';
FLUSH PRIVILEGES;
```

### 3. Deploy aplicatie

```bash
cd /opt
sudo git clone <repo-ul-tau> service-admin
cd service-admin
sudo npm install
```

Configureaza `apps/server/.env` si `apps/web/.env`, apoi:

```bash
sudo npm run db:generate
sudo npm run db:migrate
sudo npm run admin:create -w @gta-service/server -- admin parola_foarte_puternica
sudo npm run build
```

### 4. Ruleaza backend cu PM2

```bash
sudo npm i -g pm2
cd /opt/service-admin/apps/server
pm2 start dist/index.js --name service-admin-api
pm2 save
pm2 startup
```

### 5. Servire frontend static cu Nginx

Build frontend-ul este in `apps/web/dist`. Config exemplu:

```nginx
server {
  listen 80;
  server_name your-domain.com;

  root /opt/service-admin/apps/web/dist;
  index index.html;

  location / {
    try_files $uri /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Activeaza config:

```bash
sudo ln -s /etc/nginx/sites-available/service-admin /etc/nginx/sites-enabled/service-admin
sudo nginx -t
sudo systemctl restart nginx
```

(OptionaI: activezi HTTPS cu `certbot`.)

## Note extensibilitate

- parser-ele sunt separate in `src/parsers`
- logica business e in `src/services`
- maparea angajatilor include alias-uri + fallback fuzzy
- endpointurile API sunt separate pe domenii (employees, timesheet, dashboard)
- scriptul `backfill.ts` poate fi extins pe canale suplimentare
- mesajele CV sunt procesate doar pentru membri activi care au rolul configurat (`EMPLOYEE_ROLE_NAME` / `EMPLOYEE_ROLE_ID`)
- mesajele de pontaj sunt ignorate daca utilizatorul tinta nu mai exista in guild
