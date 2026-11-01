# homebridge-alfen-eve-modbus

HomeKit-schakelaar die het laden op een **Alfen Eve Single S-line** aan- of uitzet via Modbus TCP.

- **Aan:** de laadpaal krijgt het setpoint `max_current_a` (standaard 16 A).
- **Uit:** de laadpaal krijgt setpoint 0 A, de auto laadt niet.
- **Fail-safe:** de laadpaal valt terug op zijn *Safe Current*. Staat die op 0 A, dan stopt het laden
  automatisch als Homebridge stopt of het netwerk wegvalt (zie stap 1 hieronder).

Het setpoint wordt elke `refresh_s` seconden herhaald, omdat de laadpaal anders na de *validity time*
(standaard 60 s) terugvalt naar de Safe Current.

## 1. Instellen op de laadpaal (Alfen ACE-app)

Verbind via Bluetooth met de ACE-app en controleer:

1. **Safe Current = 0 A.** Dit is de belangrijkste instelling. Zonder dit laadt de auto na een uitval door op
   de ingestelde Safe Current.
2. **Energy Management / TCP/IP EMS** ingeschakeld, protocol *Modbus TCP/IP*, control mode *Socket*.
3. **Validity time = 60 s.**
4. **Modbus TCP-server** actief op poort 502. Op de S-line is dit mogelijk alleen met de juiste licentie
   (Load Balancing). Controleer dit met de probe in stap 2 voordat je Homebridge installeert.
5. Geef de laadpaal een **vast IP-adres** (DHCP-reservering in je router).

## 2. Verbinding testen

```bash
cd ~/homebridge-alfen-eve
npm install
node scripts/probe.js <IP-laadpaal>
```

Je ziet de beschikbaarheid, de valid time en het huidige setpoint. Lukt dit niet, dan staat de Modbus-server
niet aan of is het IP-adres verkeerd.

## 3. Installeren in Homebridge

Op de machine waar Homebridge draait:

```bash
npm install /pad/naar/homebridge-alfen-eve
```

Voeg dit toe aan `platforms` in `config.json` en herstart Homebridge:

```json
{
  "platform": "AlfenEveModbus",
  "name": "Alfen Eve laadpaal",
  "host": "<IP-laadpaal>",
  "unit_id": 1,
  "max_current_a": 16,
  "refresh_s": 20
}
```

In de Home-app verschijnt een schakelaar. **Uit** betekent: de laadpaal krijgt 0 A.

## Gedrag na een herstart

De schakelaarstand wordt opgeslagen in de Homebridge-opslag. Na een herstart herstelt de plugin die stand.
Bij de eerste start staat de schakelaar op **uit**, zodat de laadpaal niet vrijgegeven wordt zonder dat je het kiest.

## Eigen automatisering

Met de Home-app kun je een automatisering maken op basis van aanwezigheid (iPhone in/uit de zone). Zet de
schakelaar dan op **uit** als niemand thuis is en op **aan** bij thuiskomst.

## Let op

- Laat het IP-adres van de laadpaal vast staan, anders wijst `host` straks nergens meer naar.
- Dit is een privéproject. Het wijzigt geen instellingen op de laadpaal behalve het setpoint via Modbus.
