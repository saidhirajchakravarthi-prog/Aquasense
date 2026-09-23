# ESP32 API

`POST /api/device/readings`

```json
{
  "deviceId": "ESP32-001",
  "temperature": 28.6,
  "turbidity": 3.2,
  "timestamp": "2026-08-26T10:30:00.000Z",
  "waterSourceId": "UUID"
}
```

The device must already be registered against the stated water source. Only temperature and turbidity are accepted. The endpoint rejects pH, TDS, fluoride, arsenic, or any additional sensor field. It returns `201` only after inserting a reading and updating device freshness.

Pump commands are sent by `POST /api/pump/command` with `{ "deviceId": "UUID", "command": "START" | "STOP" }`. The API returns `409` when the device is offline; a web success message is not proof that the physical relay ran.
