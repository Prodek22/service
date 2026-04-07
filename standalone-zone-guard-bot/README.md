# Standalone Zone Guard Bot

Bot Discord separat pentru lista de prezenta intr-o zona:
- buton `Intrare` -> userul intra in lista
- buton `Ieșire` -> userul iese din lista + se contorizeaza durata
- buton `Șterge listă` -> reset lista (doar roluri permise / admin)

## Instalare

```bash
cd standalone-zone-guard-bot
npm install
cp .env.example .env
```

Completeaza `.env`:
- `DISCORD_TOKEN`
- `DISCORD_GUILD_ID`
- `ZONE_CHANNEL_ID`
- `ZONE_NAME` (optional)
- `ZONE_PANEL_MESSAGE_ID` (optional)
- `ZONE_ADMIN_ROLE_IDS` (optional, separate prin virgula)

## Pornire

```bash
npm start
```

## Comenzi slash

- `/zona-panel` -> creeaza/reface panelul
- `/zona-total` -> vezi totalul tau acumulat

## Persistenta

Datele se salveaza local in:

`data/zone-state.json`

Astfel, dupa restart botul pastreaza lista si totalurile.
