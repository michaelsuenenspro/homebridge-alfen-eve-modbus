# homebridge-alfen-eve-modbus

A HomeKit switch that enables or disables charging on an **Alfen Eve Single S-line** charger via Modbus TCP.

- **On:** the charger gets a setpoint of `max_current_a` (default 16 A).
- **Off:** the charger gets a setpoint of 0 A, so the car does not charge.
- **Fail-safe:** the charger falls back to its *Safe Current*. If that is set to 0 A, charging stops automatically when Homebridge stops or the network drops (see step 1).

The setpoint is re-sent every `refresh_s` seconds, because the charger otherwise falls back to its safe current after the *validity time* (60 s by default).

## Requirements

- **Alfen Eve Single S-line** (or another Alfen with ACE) with firmware that supports the Modbus TCP/IP EMS function.
- **Load Balancing licence** active on the charger. Without it there is no Modbus TCP access.
- **Modbus TCP Smart Charging** enabled in the ACE app, with:
  - Control mode: *Socket*
  - Validity time: 60 s
  - Safe current: 0 A
- **Modbus TCP server** reachable on port 502 from the Homebridge machine.
- **Homebridge** 1.6 or later, **Node.js** 18.15 or later.
- If the charger is on a different VLAN, a firewall rule that allows TCP 502 from the Homebridge machine to the charger's IP. For the ACE app you also need an mDNS reflector between the VLANs.

## 1. Configure the charger (Alfen ACE app)

Connect to the charger over Bluetooth with the ACE app and check:

1. **Safe Current = 0 A.** This is the most important setting. If it is higher, the car keeps charging after a network failure at that current.
2. **Energy Management / TCP/IP EMS** enabled, protocol *Modbus TCP/IP*, control mode *Socket*.
3. **Validity time = 60 s.**
4. **Modbus TCP server** active on port 502. On the S-line this requires the Load Balancing licence.
5. Give the charger a **fixed IP address** (DHCP reservation in your router).

## 2. Test the connection

```bash
git clone https://github.com/michaelsuenenspro/homebridge-alfen-eve-modbus.git
cd homebridge-alfen-eve-modbus
npm install
node scripts/probe.js <charger-ip>
```

The probe prints the availability, the valid time and the current setpoint. If it fails, the Modbus server is not enabled or the IP address is wrong.

## 3. Install in Homebridge

On the machine that runs Homebridge:

```bash
npm install /path/to/homebridge-alfen-eve-modbus
```

Add this to `platforms` in `config.json` and restart Homebridge:

```json
{
  "platform": "AlfenEveModbus",
  "name": "Alfen Eve charger",
  "host": "<charger-ip>",
  "unit_id": 1,
  "max_current_a": 16,
  "refresh_s": 20
}
```

A switch appears in the Home app. **Off** means the charger gets 0 A.

## Behaviour after a restart

The switch state is saved in the Homebridge storage folder and restored after a restart. On the very first start the switch is **off**, so the charger is never released without you choosing it.

## Automation

Use the Home app to automate the switch based on presence, for example turning it off when everyone leaves and on when someone arrives.

## Notes

- Keep the charger's IP address fixed, otherwise `host` will point to nothing.
- The plugin only writes the Modbus setpoint. It does not change any other charger settings.

## License

Copyright © 2026 Michael Suenens — Ancilux Services. All rights reserved.
See [LICENSE](LICENSE). Use, copying or modification without written permission is not allowed.
