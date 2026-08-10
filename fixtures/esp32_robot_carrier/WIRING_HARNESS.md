# Trashbot v1 final wiring and ESP32 pin contract

This document is the assembly source of truth for `esp32_robot_carrier_v3`.
Read the reference designator and net label printed on the PCB; do not infer a
function from harness color. Perform an unpowered continuity check before
connecting the battery, controllers, Raspberry Pi, RGB pixels, or servo.

## Battery and high-current power

The motor-current path does **not** pass through this carrier.

```text
36–42 V pack positive
  -> pack-side main fuse / disconnect / emergency stop
     -> separately fused left WinXu 36/48 V 350 W 18 A controller branch
     -> separately fused right WinXu 36/48 V 350 W 18 A controller branch
     -> separately fused carrier branch -> J_BAT pad 1

36–42 V pack negative
  -> both controller battery-negative leads
  -> J_BAT pad 2 / carrier GND
```

The two controllers can demand approximately 36 A in aggregate before
accessories. Size the pack BMS, disconnect, main fuse, branch fuses, connectors,
and wire for the actual controller limits and motor stall behavior. F1 on this
carrier protects only the carrier after `J_BAT`; it does not protect either
motor controller or the cable between the pack and the board.

| Connector | Pin/pad | Connection |
| --- | ---: | --- |
| `J_BAT` | 1 | 36–42 V pack positive through pack-side carrier fuse |
| `J_BAT` | 2 | Pack negative / common ground |
| `J_PI_PWR` | 1, 2 | F2-protected 5.10 V to Raspberry Pi power input |
| `J_PI_PWR` | 3, 4 | Raspberry Pi power ground |
| `J_RGB_5V` | 1 | 5.10 V RGB power |
| `J_RGB_DATA` | 1 | One buffered 5 V RGB data line from GPIO2 |
| `J_RGB_GND` | 1 | RGB ground |
| `J_SERVO` | 1 | GPIO13 servo/PWM signal, 3.3 V logic with 100 kΩ reset pull-down |
| `J_SERVO` | 2 | F3-protected and filtered 24 V servo power |
| `J_SERVO` | 3 | Servo ground |
| `J_24V_AUX` | 1 | Same fused 24 V rail as the servo |
| `J_24V_AUX` | 2 | Ground |

The 5.10 V rail is guaranteed only to the conservative 8.0 A low-line limit at
the bottom of the pack. Above 36 V, the 50 W module limit caps the trimmed rail
at 9.80 A. The Raspberry Pi branch is fused at 5 A. Everything on 5 V must fit:

```text
Ipi + Iesp32/logic + Iultrasonic + 0.060 A × RGB_pixel_count <= available 5 V current
```

The 24 V converter is limited to 2.5 A total, shared by `J_SERVO` and
`J_24V_AUX`, and may require thermal derating in the enclosure. Confirm the
servo accepts 24 V power, a common ground, and a 3.3 V RC-style PWM input.
Servos needing 5 V logic, 0–10 V, open-collector, step/direction, CAN, or RS-485
need the matching external interface; the power voltage alone does not prove
signal compatibility.

## Left WinXu controller

| Controller connection | Carrier connection | Rule |
| --- | --- | --- |
| Throttle signal | `J_LTHR` | Signal only; amplified range is approximately 0–4.21 V |
| Throttle/signal ground | `J_LCTRL_GND` | Required common reference for throttle and Hall taps |
| Controller throttle 5 V | No connection | Insulate it; never connect it to carrier 5.10 V |
| Low-level brake pair | `J_LBRK` pads 1 and 2 | Floating contact; no polarity; close `JP_LBRK` only after bench identification |
| Labelled reverse pair | `J_LREV` pads 1 and 2 | Floating contact; no polarity; close `JP_LREV` only after bench identification |
| Motor Hall A signal tap | `J_LHALLA` | Leave the original Hall connector attached to the controller |
| Motor Hall B signal tap | `J_LHALLB` | Signal tap only |
| Motor Hall C signal tap | `J_LHALLC` | Signal tap only |

Do not use a high-level brake wire or the controller's self-learning connector
as the brake/reverse contact. Identify the labelled low-level brake and reverse
pairs from the exact delivered controller and verify their open-circuit voltage
is below 48 V before closing either enable jumper.

## Right WinXu controller

| Controller connection | Carrier connection | Rule |
| --- | --- | --- |
| Throttle signal | `J_RTHR` | Signal only; amplified range is approximately 0–4.21 V |
| Throttle/signal ground | `J_RCTRL_GND` | Required common reference for throttle and Hall taps |
| Controller throttle 5 V | No connection | Insulate it; never connect it to carrier 5.10 V |
| Low-level brake pair | `J_RBRK` pads 1 and 2 | Floating contact; no polarity; close `JP_RBRK` only after bench identification |
| Labelled reverse pair | `J_RREV` pads 1 and 2 | Floating contact; no polarity; close `JP_RREV` only after bench identification |
| Motor Hall A signal tap | `J_RHALLA` | Leave the original Hall connector attached to the controller |
| Motor Hall B signal tap | `J_RHALLB` | Signal tap only |
| Motor Hall C signal tap | `J_RHALLC` | Signal tap only |

Each Hall input has a 10 kΩ/12 kΩ divider and its own 10 nF capacitor at the
ESP32-side node. Connect only A/B/C signal taps and controller signal ground;
do not connect the controller's Hall 5 V supply to the carrier 5 V rail.

## Waterproof ultrasonic sensors

Use the modules in ordinary TRIG/ECHO pulse-width mode. For AJ-SR04M V2.0,
leave R19 open/NC. Confirm the installed JSN-SR04T revision's mode selection.

| Position | VCC/GND | Trigger | Echo |
| --- | --- | --- | --- |
| Left | Any `JP1V`–`JP6V` 5 V pad and matching `JP1G`–`JP6G` ground pad | `J_LTRIG` → buffered GPIO15 | `J_LECHO` → divided GPIO35 |
| Front | Any unused 5 V/GND pair | `J_FTRIG` → buffered GPIO5 | `J_FECHO` → divided GPIO33 |
| Right | Any unused 5 V/GND pair | `J_RTRIG` → buffered GPIO18 | `J_RECHO` → divided GPIO39 |

The six auxiliary 5 V pads are `JP1V` through `JP6V`; the six grounds are
`JP1G` through `JP6G`. Keep pings sequential and at least 60 ms apart. Discard
startup echoes until all trigger pins have been driven LOW and the first 60 ms
quiet interval has elapsed.

## ESP32 DevKit socket, every exposed pin

Only a 30-pin ESP32 DevKit V1 / `esp32dev` with an ESP32-WROOM-32-class module
fits this contract. Do not fit a 38-pin DevKitC, rotate the module, or substitute
a WROVER/PSRAM module that can reserve GPIO16/GPIO17. With the PCB text upright,
the antenna is at the pad-1/top end and USB is at the pad-15/bottom end.

| Socket pad | ESP32 pin | Carrier use | Direction / reset concern |
| --- | --- | --- | --- |
| `J_ESP_L.1` | EN | Intentionally unconnected | DevKit reset circuit owns it |
| `J_ESP_L.2` | GPIO36 | Left Hall C | Input-only; ADC-power erratum applies |
| `J_ESP_L.3` | GPIO39 | Right ultrasonic echo | Input-only; ADC-power erratum applies |
| `J_ESP_L.4` | GPIO34 / ADC1_CH6 | 25:1 battery monitor | Input-only; 36–42 V becomes 1.44–1.68 V |
| `J_ESP_L.5` | GPIO35 | Left ultrasonic echo | Input-only |
| `J_ESP_L.6` | GPIO32 | Right brake PhotoMOS | Output, 100 kΩ reset pull-down |
| `J_ESP_L.7` | GPIO33 | Front ultrasonic echo | Input |
| `J_ESP_L.8` | GPIO25 / DAC1 | Left throttle | DAC through filter and ×1.2745 amplifier |
| `J_ESP_L.9` | GPIO26 / DAC2 | Right throttle | DAC through filter and ×1.2745 amplifier |
| `J_ESP_L.10` | GPIO27 | Left reverse PhotoMOS | Output, 100 kΩ reset pull-down |
| `J_ESP_L.11` | GPIO14 | Right reverse PhotoMOS | Output; also a default JTAG pin |
| `J_ESP_L.12` | GPIO12 | Left brake PhotoMOS | Boot strap; local 100 kΩ pull-down keeps it LOW |
| `J_ESP_L.13` | GPIO13 | Servo signal | 3.3 V output with 100 kΩ reset pull-down; also a default JTAG pin |
| `J_ESP_L.14` | GND | Carrier ground | Common reference |
| `J_ESP_L.15` | VIN | `JP_ESP_PWR` selected | Keep jumper open when normal USB VBUS is present |
| `J_ESP_R.1` | 3V3 | Logic rail source from DevKit | Do not apply an external 3.3 V supply |
| `J_ESP_R.2` | GND | Carrier ground | Common reference |
| `J_ESP_R.3` | GPIO15 | Left ultrasonic trigger buffer | Boot strap; buffer input is high impedance |
| `J_ESP_R.4` | GPIO2 | Single RGB data buffer | Boot strap; no external auxiliary pad |
| `J_ESP_R.5` | GPIO4 | I2C SDA reserve | Breakout at `J_SDA` |
| `J_ESP_R.6` | GPIO16 | Left Hall A | Input; do not use a WROVER module |
| `J_ESP_R.7` | GPIO17 | Left Hall B | Input; do not use a WROVER module |
| `J_ESP_R.8` | GPIO5 | Front ultrasonic trigger buffer | Boot strap; buffer input is high impedance |
| `J_ESP_R.9` | GPIO18 | Right ultrasonic trigger buffer | Output |
| `J_ESP_R.10` | GPIO19 | Right Hall A | Input |
| `J_ESP_R.11` | GPIO21 | Right Hall B | Input |
| `J_ESP_R.12` | GPIO3 / RX0 | USB serial/Pi command receive | Passive `J_RX0` test pad only; do not add a second Pi TTL link |
| `J_ESP_R.13` | GPIO1 / TX0 | USB serial/Pi logs/transmit | Passive `J_TX0` test pad only |
| `J_ESP_R.14` | GPIO22 | Right Hall C | Input |
| `J_ESP_R.15` | GPIO23 | I2C SCL reserve | Breakout at `J_SCL` |

GPIO0 is not exposed by this 30-pin socket. GPIO6–GPIO11 are internal flash
signals and are not exposed. GPIO34–GPIO39 are never used as outputs. The board
uses GPIO12–GPIO15, so classic four-wire JTAG is unavailable; USB flashing,
boot logs, diagnostics, and Raspberry Pi communication remain available on
GPIO1/GPIO3 through the DevKit USB connection.

Normal Raspberry Pi operation uses a powered USB cable to the ESP32 DevKit and
requires `JP_ESP_PWR` to remain **open**. Close it only when USB is absent or a
verified data-only cable has no VBUS. Do not wire `J_RX0`/`J_TX0` to Pi UART
while also using the USB serial link.

## Comparison with `guy16510/hoverboard-robot`

The comparison below uses `firmware/esp32/board_config.h` at repository commit
`94c58a4` reviewed on 2026-08-10. Firmware constants are easier to change than
the PCB, but these migrations are mandatory before enabling motor power.

| Function | Repository pin/state | Trashbot v1 board | Required firmware action |
| --- | --- | --- | --- |
| Left/right throttle | GPIO25 / GPIO26 | Same pins, hardware gain ×1.2745 | Start with DAC-side idle/start/max near 0.85/0.92/3.25 V and calibrate |
| Left/right reverse | GPIO27 / GPIO14 | Same | Keep disabled until labelled controller pairs are proven |
| Left brake | GPIO33 | GPIO12 | Change pin and uniqueness checks |
| Right brake | GPIO32 | Same | None |
| Left Hall A/B/C | GPIO16/17/36, disabled | Same | Enable only after all three taps pass state/transition tests |
| Right Hall A/B/C | GPIO19/21/22 | Same | None |
| Front ultrasonic | TRIG GPIO5 / ECHO GPIO34 | TRIG GPIO5 / ECHO GPIO33 | Change echo pin and echo-pin assertion |
| Left ultrasonic | TRIG GPIO15 / ECHO GPIO35 | Same | None |
| Right ultrasonic | TRIG GPIO18 / ECHO GPIO39 | Same | None |
| Ultrasonic schedule | 40 ms spacing | Modules require at least 60 ms | Increase spacing and serialize pings |
| I2C reserve | SDA GPIO4 / SCL GPIO23 | Same breakout pads | Available for MPU6050 or PCA9685 expansion |
| Servo | GPIO13 | Same signal, now with 24 V power | Add/verify servo firmware and exact signal protocol |
| RGB | Not in the reviewed pin table | GPIO2, one buffered data line | Add driver; force LOW during boot; cap brightness/current |
| Battery voltage | Not present | GPIO34 / ADC1_CH6 | Add averaged ADC read and calibration |
| USB/Pi serial | GPIO3 RX0 / GPIO1 TX0 | Preserved | Keep these pins out of all other allocations |

Recommended compile-time checks should require every assigned GPIO to be
unique, preserve GPIO1/GPIO3 for UART0, keep all input-only pins out of output
lists, explicitly assert front echo GPIO33/left brake GPIO12/battery ADC GPIO34,
and keep trigger outputs LOW until initialization completes.

## First-power hold points

1. Leave all four brake/reverse enable jumpers open, wheels off the ground, and
   motor controllers disconnected from carrier signals.
2. Remove F2/F3, current-limit a bench supply at 36 V, and verify polarity,
   `VIN_PROTECTED`, 5.10 V, and 24.0 V before inserting the ESP32 or loads.
3. Load-test 5 V and 24 V independently, then simultaneously, while measuring
   connector, fuse, MOSFET, converter, capacitor, and copper temperatures.
4. With normal Pi USB connected, confirm `JP_ESP_PWR` is open and verify flashing,
   logs, and bidirectional Pi commands.
5. Verify both throttle outputs stay near 0 V during reset and loss of firmware,
   then calibrate idle/start/max with one wheel/controller at a time.
6. Prove every Hall state, every ultrasonic channel, RGB current limiting, servo
   stall current, brake, and labelled reverse before lowering wheels.
7. Scope the 24 V rail during fast servo deceleration. Sustained regeneration
   cannot be absorbed safely by the fitted pulse TVS and needs an external
   servo-rated brake clamp or dump load.
