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
REACTION_TRACK_MESSAGE_IDS=
AUTH_JWT_SECRET=change_this_to_a_long_random_secret
CORS_ORIGIN=http://localhost:5173
AUTH_COOKIE_SECURE=true
TIMESHEET_DAILY_SYNC_ENABLED=true
TIMESHEET_SYNC_INTERVAL_HOURS=24
TIMESHEET_SYNC_DAYS=14
AUTO_CLEANUP_ENABLED=true
AUTO_CLEANUP_INTERVAL_HOURS=720
AUTO_CLEANUP_KEEP_CYCLES=12
AUTO_CLEANUP_RUN_ON_START=false
MAINTENANCE_WORKER_MAX_OLD_SPACE_MB=256
SERVICE_COVERAGE_ENABLED=false
SERVICE_COVERAGE_EXTRA_CHANNEL_ID=
SERVICE_COVERAGE_HELP_CHANNEL_ID=
SERVICE_COVERAGE_HELP_ROLE_IDS=
SERVICE_COVERAGE_MANAGER_ROLE_IDS=
SERVICE_COVERAGE_MANAGER_USER_IDS=
SERVICE_COVERAGE_PRECHECK_TIME=17:55
SERVICE_COVERAGE_START_TIME=18:00
SERVICE_COVERAGE_END_TIME=23:00
SERVICE_COVERAGE_CHECK_INTERVAL_MINUTES=10
SERVICE_COVERAGE_PRECHECK_MIN_MECHANICS=2
SERVICE_COVERAGE_ALERT_COOLDOWN_MINUTES=9
STATION_FREQUENCY_ENABLED=false
STATION_FREQUENCY_CHANNEL_ID=
STATION_FREQUENCY_ROLE_IDS=
STATION_FREQUENCY_MANAGER_ROLE_IDS=
STATION_FREQUENCY_MANAGER_USER_IDS=
DATABASE_URL="mysql://user:password@localhost:3306/service_admin"
PORT=3001
```

### Acoperire service extra

Pentru alerta automata 18:00-23:00 si pontajul extra de manageri:

- Orele de mai jos sunt interpretate explicit in timezone-ul `Europe/Bucharest`, indiferent de timezone-ul VPS-ului.
- `SERVICE_COVERAGE_ENABLED=true` activeaza modulul.
- `SERVICE_COVERAGE_EXTRA_CHANNEL_ID` este canalul `pontaj-extra`, unde botul posteaza mesajul cu butoanele `Intrare`, `Iesire`, `Sterge lista`.
- `SERVICE_COVERAGE_HELP_CHANNEL_ID` este canalul `ajutor-service`, unde botul trimite alerta.
- `SERVICE_COVERAGE_HELP_ROLE_IDS` este lista de roluri mentionate in alerta, separate prin virgula.
- `SERVICE_COVERAGE_MANAGER_ROLE_IDS` limiteaza cine poate folosi pontajul extra; daca ramane gol, pot apasa doar membrii cu permisiuni Discord de administrator/manage guild.
- `SERVICE_COVERAGE_MANAGER_USER_IDS` permite useri expliciti, separat de roluri.
- La `SERVICE_COVERAGE_PRECHECK_TIME` botul alerteaza daca sunt mai putini mecanici decat `SERVICE_COVERAGE_PRECHECK_MIN_MECHANICS`.
- Intre `SERVICE_COVERAGE_START_TIME` si `SERVICE_COVERAGE_END_TIME`, botul verifica la fiecare `SERVICE_COVERAGE_CHECK_INTERVAL_MINUTES`; daca nu exista niciun pontaj mecanic si niciun manager pe acoperire, trimite alerta.

### Frecventa statiei

Pentru panoul separat de frecventa radio:

- `STATION_FREQUENCY_ENABLED=true` activeaza panoul.
- `STATION_FREQUENCY_CHANNEL_ID` este canalul separat unde botul posteaza mesajul `Frecventa statiei`.
- `STATION_FREQUENCY_ROLE_IDS` este lista de roluri mentionate in mesaj, separate prin virgula.
- `STATION_FREQUENCY_MANAGER_ROLE_IDS` limiteaza cine poate apasa `Statie noua`; daca ramane gol, pot apasa doar membrii cu permisiuni Discord de administrator/manage guild.
- `STATION_FREQUENCY_MANAGER_USER_IDS` permite useri expliciti, separat de roluri.
- Frecventa este generata aleatoriu in format `123.456`, cu sase cifre, ca sa fie greu de ghicit.
- La apasarea butonului `Statie noua`, botul sterge mesajul vechi si posteaza unul nou, cu tag la rolurile din `STATION_FREQUENCY_ROLE_IDS`.

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

- `GET /api/maintenance/job-status`
- `POST /api/maintenance/delete-old` (body: `{ "olderThanDays": 90 }`)
- `POST /api/maintenance/sync-new` (porneste job async, body: `{ "latestLimitPerChannel": 100 }`)
- `POST /api/maintenance/sync-timesheet-window` (porneste job async, body: `{ "days": 14 }`)
- `POST /api/maintenance/recalculate-timesheets` (porneste job async: recalcul complet pontaje, fara reset)
- `POST /api/maintenance/rebuild-all` (porneste job async: sterge complet datele operationale + backfill complet)
- `POST /api/maintenance/cleanup-retention` (porneste cleanup automat/manual, body optional: `{ "keepCycles": 12 }`)
- `GET /api/maintenance/reaction-track-messages`
- `POST /api/maintenance/reaction-track-messages` (body: `{ "messageId": "123456789012345678" }`)
- `DELETE /api/maintenance/reaction-track-messages/:messageId`

Optional Discord reaction audit:

- set `REACTION_TRACK_MESSAGE_IDS` (comma-separated message IDs) in `apps/server/.env`
- sau configureaza din Dashboard (input Message ID)
- bot logs `DISCORD_REACTION_ADD` / `DISCORD_REACTION_REMOVE` in `audit_logs`

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
