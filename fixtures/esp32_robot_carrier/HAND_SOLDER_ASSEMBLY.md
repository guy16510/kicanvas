# Hand-solder assembly, ESP32 Robot Carrier v3

This carrier is intentionally laid out for soldering with a normal temperature-controlled iron and flux. It does not require a stencil or reflow oven.

## Hand-solder design rules

- Ordinary resistor and capacitor footprints are 1206 with oversized 1.8 mm square lands.
- The three ultrasonic trigger level shifters and the RGB level shifter are consolidated into one through-hole `SN74AHCT125N` DIP-14 (`U11`).
- Brake and reverse isolation uses four through-hole Panasonic `AQY212GH` DIP-4 PhotoMOS relays (`U6` through `U9`).
- The `TLV9002` throttle amplifier (`U10`) remains SOIC-8 but uses extended 2.2 x 0.7 mm toe pads.
- The `LTC4367` protection controller (`U4`) must remain MSOP-8 and is the only intentionally fine-pitch part. Its pads are extended to 2.2 x 0.5 mm for drag soldering.
- Power modules, fuse holders, terminal blocks, ESP32 sockets, MOSFETs, and large electrolytics are through-hole.
- Large SMB/SMC/1210 power parts remain SMT because their packages are already easy to reach with an iron.
- Electrolytic polarity and IC pin 1 are marked on the board.
- The ground zones retain thermal-relief geometry so 2 oz copper does not turn normal hand-solder joints into heat sinks.

The old single-gate buffer lands (`U_RGB`, `U_TRIG_L`, `U_TRIG_F`, `U_TRIG_R`) remain only as DNP test anchors. Do not populate them. They are excluded from the BOM and component-placement file.

## Recommended assembly order

1. Solder `U4` first while the board is empty. Flux heavily, tack one corner, align the package, tack the opposite corner, then drag-solder the remaining pins.
2. Install the 1206 resistors and capacitors.
3. Install `U10` and the large SMT TVS/ferrite/1210 parts.
4. Install `U11` and `U6` through `U9`.
5. Install small through-hole headers and sockets.
6. Install terminal blocks, fuse holders, electrolytics, TO-220 MOSFETs, and the two DC-DC modules last.
7. Inspect for bridges and verify resistance between each power rail and ground before fitting fuses or connecting the battery.

## Soldering notes

Use flux. For 1206 parts, tin one pad, hold the component with tweezers while reheating that pad, then solder the second side and touch up the first. For `U4`, a fine chisel tip is usually easier to control than a needle tip because it transfers heat into both the lead and the extended toe pad.

The PCB is 2 oz copper. Large power pads may still require more dwell time than signal pads. Do not defeat the designed fuse/protection paths by adding solder bridges or wire jumpers across them.

## Build validation

The repository CI regenerates the final board from source, applies the hand-solder transform, runs the existing electrical/system validators, runs the hand-solder-specific validator, refills zones with KiCad 10, runs DRC gating, regenerates Gerbers/drill/IPC-D-356/placement/stats/renderings, and validates the fabrication package. The checked-in fabrication directory is generated from that same final hand-solder board.
