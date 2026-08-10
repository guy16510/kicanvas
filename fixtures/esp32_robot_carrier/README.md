# ESP32 robot carrier: 36–42 V input, 5 V/24 V power, and battery sensing

The generated v3 carrier accepts a 36–42 V battery, protects the input with the
LTC4367 stage, and feeds two isolated through-hole DC-DC modules: a regulated
5.10 V nominal rail for the Raspberry Pi, ESP32 peripherals, sensors, and RGB pixels, plus
a separately fused 24 V / 2.5 A rail for a servo. The protected battery voltage
is exposed to the ESP32 on GPIO34. A dual rail-to-rail amplifier lets the two
ESP32 DACs cover the exact WinXu controllers' approximately 1.1–4.2 V throttle
range. Four PhotoMOS relays provide floating
two-wire brake and reverse contacts for the two motor controllers. The older v2
fixture remains a 5 V-only board and must never be connected directly to the
36–42 V battery.

The front silkscreen identifies the product as **Trashbot v1** and the maker as
**Burns Industries**, while retaining `CARRIER rev3` as the PCB revision.
Use [`WIRING_HARNESS.md`](WIRING_HARNESS.md) as the single assembly map for
power, both WinXu controllers, Hall taps, ultrasonic modules, RGB, servo, Pi
USB, and every exposed ESP32 socket pin.

## Safety

36–42 V battery packs can supply destructive fault current. Fit the specified
fuse, verify polarity before connecting the pack, and test a first assembly from
a current-limited bench supply. Do not bypass the protection FETs or replace the
series ADC resistors with jumpers. Confirm the selected 0805 resistors have a
working-voltage rating of at least 50 V; the two top resistors split the possible
surge voltage.

This circuit estimates remaining usable energy from terminal voltage. It is not
a cell-level battery-management system and cannot replace the pack BMS.

## Replaceable fuse holders

The v3 board has three replaceable 5×20 mm through-hole fuse positions. All use
the 22 mm lead-pitch footprint for Littelfuse `0PTF0015P`, a 250 V, 6.3 A-rated
PCB holder. See the
[manufacturer data sheet](https://www.littelfuse.com/assetdocs/littelfuse_fuse_block_ptf015_datasheet.pdf?assetguid=4413c71d-437b-411b-9c0c-09971540e8fc).

| Reference | Protected circuit | Fuse requirement |
| --- | --- | --- |
| F1 | `J_BAT` positive input, before the TVS, LTC4367, MOSFETs, and both converters | Eaton Bussmann `S505H-5-R`: 5 A time-delay ceramic, 5×20 mm, 400 VDC |
| F2 | Both positive pins of `J_PI_PWR` only | Eaton Bussmann `S505H-5-R`: 5 A time-delay ceramic, 5×20 mm, 400 VDC; use wiring rated for at least 5 A |
| F3 | 24 V servo output before the ferrite, `J_SERVO`, and `J_24V_AUX` | Eaton Bussmann `S505H-3.15-R`: 3.15 A time-delay ceramic, 5×20 mm, 400 VDC |

Do not install a common 32 V automotive blade fuse at F1: a 42 V pack exceeds
that voltage rating. The fuse link—not only the holder—must have a suitable DC
voltage rating and DC breaking capacity for the pack's available fault current.
The selected S505H links have a 1500 A interrupt rating at 400 VDC; see the
[Eaton S505H data sheet](https://www.eaton.com/content/dam/eaton/products/electronic-components/resources/data-sheet/eaton-s505h-vac-time-delay-fuses-data-sheet.pdf).
F2 and F3 do not increase converter capacity. The 5 V consumers must fit within
the Murata module's 8 A low-line rating at the bottom of the pack. At higher
input voltage, the 5.10 V trim makes the data sheet's 50 W output-power limit
9.80 A rather than 10 A; the
servo and auxiliary 24 V load share the Traco module's 2.5 A maximum. The F3
link is intentionally rated above the converter's normal full-load current to
avoid nuisance opening; it does not authorize a 3.15 A continuous load.

F1 protects the carrier after the battery connector. It cannot protect the
battery cable before `J_BAT`, so install an additional appropriately rated
pack-side fuse as close to battery positive as practical. Never bypass any
holder with wire or solder. The two 350 W / 18 A motor controllers remain
outside this carrier and each needs its own pack-side branch fuse and wiring.

## Battery-sense circuit

| Reference | Value | Connection | Purpose |
| --- | --- | --- | --- |
| R40 | 240 kΩ, 1%, 0805 | `VIN_PROTECTED` to `BATTERY_DIVIDER_MID` | First high-side resistor |
| R41 | 240 kΩ, 1%, 0805 | `BATTERY_DIVIDER_MID` to `BATTERY_ADC_GPIO34` | Second high-side resistor |
| R42 | 20 kΩ, 1%, 0805 | `BATTERY_ADC_GPIO34` to GND | Divider bottom |
| C20 | 100 nF | `BATTERY_ADC_GPIO34` to GND | ADC reservoir/noise filter |

The divider is connected after the LTC4367 protection FETs. If input protection
disconnects the pack, the divider cannot back-power an otherwise unpowered ESP32
through GPIO34.

The scale factor is exactly 25 with nominal values:

```text
Vbattery = Vgpio34 × (240k + 240k + 20k) / 20k
         = Vgpio34 × 25
```

| Protected battery | GPIO34 nominal |
| ---: | ---: |
| 36.0 V | 1.44 V |
| 39.0 V | 1.56 V |
| 42.0 V | 1.68 V |

The divider draws 84 µA at 42 V. Its Thevenin resistance is 19.2 kΩ, and C20
gives a nominal 1.92 ms time constant. Average multiple readings and allow at
least 10 ms after power-up or a major load transition before treating a sample as
settled.

The v3 input uses an SMCJ48A TVS. Littelfuse specifies a 77.4 V maximum clamp at
the rated peak pulse current. The nominal divider output at that clamp is 3.096 V;
with 1% worst-case resistor tolerance it remains about 3.16 V. See the
[Littelfuse SMCJ data sheet](https://m.littelfuse.com/~/media/electronics/datasheets/tvs_diodes/littelfuse_tvs_diode_smcj_datasheet.pdf.pdf).
This is transient headroom, not permission to apply more than the carrier's
specified 42 V maximum continuously.

## Pin assignment change

GPIO34 is `ADC1_CH6`, input-only, and is not a boot strap. ADC1 was selected so
the measurement remains available when Wi-Fi is running; Espressif documents
that ADC2 pins cannot be used with Wi-Fi. See the
[ESP32 GPIO table](https://docs.espressif.com/projects/esp-idf/en/v4.4.1/esp32/api-reference/peripherals/gpio.html).

| Function | v2 | v3 with battery sensing |
| --- | --- | --- |
| Battery voltage | Not available | GPIO34 / ADC1_CH6 |
| Front ultrasonic echo | GPIO34 | GPIO33 |
| Left brake | GPIO33 | GPIO12 / pulled-down boot strap |
| UART0 transmit/logging | GPIO1 | GPIO1, unchanged |
| UART0 receive / Pi commands | GPIO3 | GPIO3, preserved |

All three echoes pass through the linked project's 10 kΩ/15 kΩ 5 V-to-3.3 V
divider. The externally driven front echo is on non-strapping GPIO33. GPIO12 is
instead the left-brake output: it sees only the local 330 Ω PhotoMOS LED path
and a 100 kΩ pull-down, which keeps the flash-voltage strap low during reset.
The motor-controller contact remains electrically floating. UART0 remains
dedicated to GPIO1/GPIO3 for the linked firmware's
bidirectional Raspberry Pi command protocol, ROM logs, flashing, and USB serial
diagnostics.

### JSN-SR04T / AJ-SR04M ultrasonic contract

JSN-SR04T and AJ-SR04M are ultrasonic distance sensors; they are separate from
the three Hall-position signals inside each hoverboard motor. The carrier powers
each ultrasonic module from 5 V and provides this four-wire interface:

| Sensor pin | Carrier connection |
| --- | --- |
| VCC | `+5V` |
| GND | GND |
| TRIG/RX | 5 V output from a dedicated 74AHCT1G125 buffer |
| ECHO/TX | 10 kΩ/15 kΩ divider to the assigned ESP32 echo GPIO |

The three trigger buffers are `U_TRIG_L`, `U_TRIG_F`, and `U_TRIG_R`, each with
its own 100 nF bypass capacitor. Their AHCT inputs recognize the ESP32's 3.3 V
logic, while their outputs provide an unambiguous 5 V-class trigger. At the
5.10 V nominal carrier rail, the nominal echo voltage after the divider is
3.06 V; at the sensor's 5.5 V maximum supply it is 3.30 V nominal. Do not power
one of these modules from 3.3 V while leaving the divider installed: the divided
echo may then be too low for a guaranteed ESP32 logic high.

Configure each module for ordinary trigger/echo pulse-width mode, not UART,
automatic-output, switch, or low-power serial mode. On AJ-SR04M V2.0 this means
R19 is open/NC. JSN-SR04T mode selection varies by board revision, so confirm
that the installed revision is in its HC-SR04-compatible trigger/echo mode. The
[AJ-SR04M V2.0 specification](https://offer-product.oss-cn-beijing.aliyuncs.com/product/offer/attachment/2211620956069/file/subPdf_485493_241735_20230310-173148512.pdf)
lists 3–5.5 V operation, a trigger-high requirement up to 0.7×VCC, a 20 cm blind
zone, and a 50 ms measurement cycle. The
[JSN-SR04T specification](https://img.ozdisan.com/ETicaret_Dosya/951866_220247.pdf)
specifies 5 V operation, approximately 30 mA working current, and a roughly
25 cm blind zone.

Firmware should hold every trigger LOW at startup, generate a conservative
20 µs HIGH pulse, fire only one ultrasonic sensor at a time, and leave at least
60 ms between transmitted pings. Use an echo timeout appropriate to the maximum
distance you actually need; a 6 m round-trip pulse can last about 35 ms. The
20–25 cm blind zone means these modules cannot be the robot's only last-resort
collision detector—retain a physical bumper or a separate short-range sensor.
Only the probe/cable is intended for exposed wet locations; enclose the sensor
PCB and connector against water and conductive debris.

GPIO5 and GPIO15 have internal boot-time pulls, and the AHCT inputs are
deliberately high impedance so they do not alter ESP32 strap levels. This means
one or more buffered TRIG outputs can be HIGH briefly before firmware configures
the GPIOs. Treat all startup echoes as invalid, initialize all three triggers
LOW before enabling the ranging scheduler, wait at least 60 ms, and then begin
one-at-a-time pings. Do not add external strap pull resistors to these pins.

The linked [hoverboard-robot firmware](https://github.com/guy16510/hoverboard-robot),
reviewed at `board_config.h` commit `94c58a4` on 2026-08-10, still defines
`kFrontEchoPin = 34` and `kLeftBrakePin = 33`. They must be changed
to GPIO33 and GPIO12 respectively before this board and that firmware are used
together. Add GPIO34 as the battery ADC pin to the firmware's uniqueness list at
the same time. Without that migration, the firmware will interpret battery
voltage as an ultrasonic echo, will not read the actual front sensor, and will
drive the wrong left-brake pin.

In `firmware/esp32/board_config.h`, the migration must also update the comment
and the existing `static_assert` that currently requires all three echo pins to
be 34 or higher. A safe firmware contract should explicitly assert that
left/right echoes remain on GPIO35/GPIO39, front echo is GPIO33, left brake is
GPIO12, battery ADC is GPIO34, and every assigned pin remains unique. It should
also reject GPIO1/GPIO3 for every sensor or actuator because UART0 owns them.
Keep every ultrasonic trigger LOW through initialization; the current
`UltrasonicArray::begin()` already does this.

The repository's current `board_config.h` already uses GPIO5/GPIO15/GPIO18 for
front/left/right trigger and GPIO16/GPIO17 for left Hall A/B, which matches this
carrier. Its top-level README and `docs/WIRING.md` still show the older trigger
assignment on GPIO16/GPIO17, so code constants—not those stale diagrams—are the
firmware source of truth. Increase `kUltrasonicPingSpacingMs` from 40 ms to at
least 60 ms for the installed waterproof modules, and enable
`kLeftHallEnabled` only after all three left Hall taps are physically verified.

## ESP32 socket and firmware contract

The carrier accepts the common **30-pin ESP32 DevKit V1 / `esp32dev`** layout
using an ESP32-WROOM-32-class module,
with 15 pins per side on 2.54 mm pitch and 25.4 mm between header centerlines.
It is not the 38-pin Espressif DevKitC V4 footprint. The antenna is at the pad-1
end of the two sockets and the USB connector is at the pad-15 end. Compare the
labels on the actual ESP32 board before inserting it; installing a different
variant or rotating the module can put 5 V on an I/O pin.
Do not substitute an ESP32-WROVER/PSRAM module: those variants can reserve
GPIO16/GPIO17 internally, while this carrier uses both pins for left motor Hall
signals. Before assembly, place the unpowered DevKit over a 1:1 print or the
bare sockets and verify all 30 labels, 2.54 mm pitch, 25.4 mm row spacing,
antenna end, and USB end without soldering it in place.

The carrier reserves a 29.4 × 11 mm copper/track/via keepout on both layers
from x=48–77.4 mm and y=13–24 mm beneath the DevKit antenna end. Do not place a
metal standoff, cable shield, battery, controller case, or conductive chassis
directly over that antenna region. The keepout preserves RF clearance on the
carrier; the final enclosure still needs a Wi-Fi/Bluetooth range test.

The executable system validator enforces this exact physical mapping. `EN` is
intentionally unconnected, and ESP32 VIN is isolated from carrier 5 V by
`JP_ESP_PWR`:

| Pad | `J_ESP_L` DevKit pin → carrier net | Pad | `J_ESP_R` DevKit pin → carrier net |
| ---: | --- | ---: | --- |
| 1 | EN → unconnected | 1 | 3V3 → `+3V3` |
| 2 | GPIO36 → left Hall C | 2 | GND → GND |
| 3 | GPIO39 → right echo | 3 | GPIO15 → buffered left trigger |
| 4 | GPIO34 → battery ADC | 4 | GPIO2 → RGB buffer only |
| 5 | GPIO35 → left echo | 5 | GPIO4 → MPU SDA reserve |
| 6 | GPIO32 → right brake | 6 | GPIO16 → left Hall A |
| 7 | GPIO33 → front echo | 7 | GPIO17 → left Hall B |
| 8 | GPIO25 → left throttle DAC | 8 | GPIO5 → buffered front trigger |
| 9 | GPIO26 → right throttle DAC | 9 | GPIO18 → buffered right trigger |
| 10 | GPIO27 → left reverse | 10 | GPIO19 → right Hall A |
| 11 | GPIO14 → right reverse | 11 | GPIO21 → right Hall B |
| 12 | GPIO12 → left brake | 12 | GPIO3/RX0 → Pi/USB serial RX |
| 13 | GPIO13 → servo | 13 | GPIO1/TX0 → Pi/USB serial TX |
| 14 | GND → GND | 14 | GPIO22 → right Hall C |
| 15 | VIN → `ESP32_VIN_USB_ISOLATED` | 15 | GPIO23 → MPU SCL reserve |

| Function | GPIO | Carrier interface | hoverboard-robot status |
| --- | ---: | --- | --- |
| Left throttle DAC | 25 | 1 kΩ/1 µF filter, TLV9002 ×1.2745, 330 Ω output, dual fail-safe pull-downs | Firmware constants must account for gain |
| Right throttle DAC | 26 | 1 kΩ/1 µF filter, TLV9002 ×1.2745, 330 Ω output, dual fail-safe pull-downs | Firmware constants must account for gain |
| Left reverse | 27 | 330 Ω LED drive, 100 kΩ pull-down, AQY212SX floating two-wire contact | Active; use only the labelled reverse pair |
| Right reverse | 14 | 330 Ω LED drive, 100 kΩ pull-down, AQY212SX floating two-wire contact | Active; use only the labelled reverse pair |
| Left brake | 12 | 330 Ω LED drive, 100 kΩ pull-down, AQY212SX floating two-wire contact | Firmware migration required |
| Right brake | 32 | 330 Ω LED drive, 100 kΩ pull-down, AQY212SX floating two-wire contact | Active |
| Left Hall A/B/C | 16 / 17 / 36 | Three 10 kΩ/12 kΩ dividers and individual 10 nF filters | Disabled until `kLeftHallEnabled = true` |
| Front ultrasonic | TRIG 5 / ECHO 33 | 74AHCT 5 V trigger; 10 kΩ/15 kΩ echo divider | Firmware migration required |
| Left ultrasonic | TRIG 15 / ECHO 35 | 74AHCT 5 V trigger; 10 kΩ/15 kΩ echo divider | Active |
| Right ultrasonic | TRIG 18 / ECHO 39 | 74AHCT 5 V trigger; 10 kΩ/15 kΩ echo divider | Active |
| MPU6050 | SDA 4 / SCL 23 | Breakout pads | Reserved, not implemented |
| Servo | 13 | 3.3 V signal with 100 kΩ reset pull-down, separately fused/filtered 24 V, ground | One direct channel; firmware addition required |
| RGB data | 2 | 74AHCT1G125 high-impedance input, 330 Ω cable resistor; no auxiliary pad | Carrier hardware only |
| Battery voltage | 34 / ADC1_CH6 | 25:1 divider and 100 nF | Firmware addition required |
| UART0 receive / Pi commands | 3 | Passive breakout only | Reserved for DevKit USB-to-UART |
| UART0 transmit / logs | 1 | Passive breakout only | Reserved for DevKit USB-to-UART |

RGB uses exactly one data line: GPIO2 feeds the 74AHCT1G125, then a 330 Ω
connector-side resistor feeds `RGB_DATA_OUT`. The connector also has 5 V,
ground, and a local 1000 µF / 10 V through-hole bulk capacitor with a marked
positive pad. Addressable pixels must be daisy-chained; the three connector
pads are power, one data signal, and ground—not separate red/green/blue PWM
channels.

Each Hall channel has its own small 10 nF capacitor from the divided GPIO node
to ground, placed beside the lower divider resistor. With 10 kΩ/12 kΩ the
nominal Hall high is 2.73 V at a 5.0 V source; even a 5.5 V source and opposing
1% resistor tolerances remain about 3.05 V. The divider's nominal Thevenin
resistance is 5.45 kΩ, so the 10 nF filter pole is about 2.9 kHz—well above the
roughly 240 Hall transitions/s observed in the linked project while providing
useful suppression of motor-edge noise.

GPIO5 and GPIO15 are boot-strapping pins but only drive high-impedance
ultrasonic TRIG inputs. GPIO2 and GPIO12 are also strapping pins. GPIO2 now has
no external auxiliary pad and drives only the high-impedance RGB buffer input.
GPIO12 drives only the left-brake PhotoMOS LED through 330 Ω; its input node has
a 100 kΩ pull-down and the output contact is isolated. Do not attach other
circuits that force any strap pin during reset. GPIO34, GPIO35, GPIO36, and
GPIO39 are input-only; the carrier uses them only as inputs. GPIO6–GPIO11, which
the ESP32 module uses for flash, are not present in the carrier pin contract.

Classic ESP32 silicon has a documented erratum in which powering SAR ADC1 or
ADC2 can pull GPIO36 and GPIO39 low for about 80 ns. This matters because the
board reads battery voltage with ADC1 while GPIO36 is a Hall interrupt input and
GPIO39 is the right ultrasonic echo. The Hall RC helps reject short external
noise, but firmware must still follow Espressif's workaround: keep ADC power
acquired while Hall interrupts are active (or ignore GPIO36/GPIO39 events around
ADC power transitions) and reject impossible Hall states/skips. Verify this on
the exact DevKit revision before enabling the left Hall channel.

### USB serial, JTAG, and ESP32 power selection

The Raspberry Pi's USB connection uses the DevKit's USB-to-UART bridge and
therefore GPIO1 (`TX0`) and GPIO3 (`RX0`). The carrier connects those nets only
to passive breakout pads—no sensor, motor control, LED, servo, or battery circuit
loads them. This preserves boot logging, flashing, diagnostics, Pi commands, and
telemetry over the same USB serial port.

USB serial is not the same as external JTAG. The classic ESP32's default JTAG
pins are GPIO12–GPIO15; this design uses them for left brake, servo, right
reverse, and left ultrasonic trigger. USB serial debugging remains fully
available, but four-wire JTAG is **not available** with the present feature set.
Preserving JTAG would require a larger redesign, such as moving several
low-speed outputs to an I/O/PWM expander.

`JP_ESP_PWR` prevents the Pi's USB 5 V and the carrier's 5 V rail from being
hard-wired together. It is a normally-open solder jumper and its safe modes are:

| Pi/USB state | `JP_ESP_PWR` | ESP32 power source |
| --- | --- | --- |
| Normal Pi USB cable connected | **Open** | USB VBUS from the Pi |
| No USB cable connected | Closed | Carrier 5 V through the DevKit VIN pin |
| Verified data-only USB cable with VBUS physically absent | Closed | Carrier 5 V through VIN |

Never close `JP_ESP_PWR` while a normal powered USB cable is connected. Never
apply a separate supply to the ESP32's 3.3 V header. Espressif explicitly lists
USB, 5 V-header, and 3.3 V-header power as mutually exclusive because combining
them can damage the board or a source. The carrier socket targets a common
third-party 30-pin `esp32dev`, whose exact USB power circuit can vary, so the
jumper is required instead of assuming that a particular clone contains a safe
isolation diode. See Espressif's
[DevKit power warning](https://docs.espressif.com/projects/esp-idf/en/v5.1.2/esp32/hw-reference/esp32/get-started-devkitc.html)
and [GPIO restriction table](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/gpio.html).

## 36–42 V to 5 V and 24 V power budget

The final power paths are:

```text
J_BAT -> F1 S505H 5 A / 400 VDC -> SMCJ48A -> LTC4367
      -> back-to-back 100 V MOSFETs -> VIN_PROTECTED

VIN_PROTECTED -> PS1 Murata UWS-5/10-Q48N-C + R44 trim -> 5.10 V nominal
              -> F2 5 A -> J_PI_PWR
              -> sensors, ESP32-side logic, and RGB output

VIN_PROTECTED -> PS2 Traco TEN 60-4815WIN -> 24 V
              -> F3 3.15 A -> FB2 -> J_SERVO + J_24V_AUX
```

The LTC4367 window is approximately 30 V undervoltage rising and 50 V
overvoltage. PS1 accepts 18–75 V and is trimmed to about 5.10 V. Use its 8 A
low-line current ceiling at the bottom of the pack. Above 36 V, the nominal
10 A current rating is reduced to 9.80 A by the data sheet's 50 W maximum-output-
power rule (`50 W / 5.099 V`). Pin 2 is tied to `-VIN` to turn its negative-logic remote input
on, sense pins are tied locally to their respective outputs, and R44 = 806 kΩ
connects Trim to ground/`-Sense`. Murata's trim-up equation gives approximately
5.099 V nominal, providing Raspberry Pi cable-drop margin while remaining below
the Pi's 5.25 V maximum. Measure the assembled rail under no-load and 5 A load;
do not populate a lower trim resistance without recalculating worst-case module
and resistor tolerance. PS2 also accepts 18–75 V and supplies 24 V at 2.5 A.
Its positive-logic Remote pin is left open for on and Trim is left open for
nominal 24 V. Both modules are isolated parts, but their input and output
negative pins are intentionally joined to carrier ground; the completed carrier
is therefore not a galvanically isolated system. The implemented pin contracts
come from the official
[Murata UWS data sheet](https://pim.murata.com/asset/pim4/isolatedDCDCconverter/UWS_PDF_ISOLATEDDCDCCONVERTER?lastModifiedDatetime=20250707193640)
and [Traco TEN 60WIN data sheet](https://www.tracopower.com/products/ten60win.pdf).

PS1 has C10 (22 µF / 100 V) and C11 (4.7 µF / 100 V) on its input, plus C18
(1 µF / 50 V ceramic) and C16 (470 µF / 10 V) on its output. PS2 has C26
(22 µF / 100 V) on its input, C25 (1 µF / 50 V) directly on its output, and C19
(470 µF / 50 V) after F3 and FB2 at the servo connector. D2 is an SMBJ26A
unidirectional TVS on that fused rail (cathode to +24 V) to absorb short servo
regeneration spikes; it is not a continuous braking dump load. Module pin spacing,
drill diameters, body outlines, and courtyards match the manufacturers' THT
drawings. Do not place hardware, wires, or conductive chassis parts in either
module courtyard or underneath the modules.

At simultaneous nominal full load the modules deliver 50 W + 60 W. Allowing for
conversion loss, the carrier can draw roughly 3.4 A from a 36 V pack; transient
and startup current can be higher. The shared 5 A time-delay F1 provides useful
margin while remaining below the 6.3 A holder rating, but the exact fuse choice
must still be proven against startup, worst-case temperature, and the actual
pack's available fault current. Murata's application guidance calls for an
external input fuse and may show a fast-blow fuse; this board intentionally uses
the high-DC-interrupt S505H time-delay family to tolerate two-module startup.
Treat that as a first-article validation item, not as a paper-only conclusion.

The 5 V load budget is independent of the servo rail:

```text
I5V = Ipi,max + Iesp32/accessory + Isensors + (0.060 A × RGB pixels)
I5V <= 8.0 A at the bottom of the pack
I5V <= 9.80 A only above 36 V and after thermal qualification
```

The 60 mA-per-pixel RGB term is a conservative full-white estimate; use the
actual LED data sheet and a firmware brightness cap. If the Pi branch uses its
full 5 A allowance at the bottom of the pack, only 3 A of the guaranteed 5 V
capacity remains for every other 5 V load. F2 protects only the Pi connector;
it does not reserve 5 A or increase converter capacity.

The 24 V rail has a separate limit:

```text
Iservo,stall + I24V_aux <= 2.5 A, with thermal derating as required
```

`J_SERVO` is pad 1 signal/GPIO13, pad 2 fused 24 V, and pad 3 ground. R53 is a
100 kΩ pull-down that keeps the signal inactive while the ESP32 is unpowered or
in reset; firmware must still command a known-safe pulse before the servo rail
is enabled.
`J_24V_AUX` pad 1 is the same fused 24 V rail and pad 2 is ground. Confirm the
servo is actually rated for 24 V and that its worst-case stall current remains
within the shared limit. The 6 A ferrite rating and 3.15 A fuse rating do not
override the converter's 2.5 A ceiling. Additional servo control channels should
use an I2C PWM expander such as a PCA9685 on GPIO4/GPIO23; they still share the
same 2.5 A power budget unless powered externally. Do not parallel servo signal
inputs directly on GPIO13.

The Traco module requires natural-convection derating above 50 °C ambient, so an
enclosed robot may not sustain 2.5 A. The Murata module also requires first-
article thermal verification. Its data sheet says no external output capacitor
is required for stability, but an external EMI input filter may be needed for
conducted-emissions compliance; the present board has local bulk/bypass parts,
not a certified system-level EMI filter.

High-current routing uses wide top/bottom copper and parallel vias where the 5 V
path changes layers; the 24 V trunk is at least 1.5 mm. These dimensions remove
obvious earlier bottlenecks but do not guarantee full rated current under every
enclosure and ambient condition. The PCB stackup explicitly requires **2 oz
(0.07 mm) copper on both outer layers**. Do not order this board with a 1 oz
default; the fabrication validator checks the copper thickness recorded in the
Gerber job file.

## Motor-controller safety boundary

The exact ordered WinXu `36/48V 350W 18A` controllers expose a three-wire
throttle input: controller 5 V, signal, and controller ground, with an expected
signal range of approximately 1.1–4.2 V. Connect only the controller signal to
`J_LTHR`/`J_RTHR` and its ground to the adjacent `J_LCTRL_GND`/`J_RCTRL_GND`.
Insulate the controller's 5 V throttle wire; never join that source to the
carrier 5.10 V rail. Harness colors vary, so identify pins from the controller
label/manual and verify with a meter instead of relying on red/black/white or
green conventions.

U10 (`TLV9002IDR`) runs from 5.10 V and applies a nominal gain of 1.2745 to
both DAC filters. A 3.3 V DAC command therefore reaches about 4.21 V at the
controller. Each input has a 100 kΩ pull-down; each controller lead has a 10 kΩ
pull-down and a 330 Ω series resistor, so an absent/resetting ESP32 or an open
amplifier-output resistor requests zero rather than motion. Verify both throttle
signal pads measure near 0 V before motor power is enabled.

The linked firmware's current direct-output constants become approximately
1.08 V idle, 1.47 V start, and 4.02 V maximum after this hardware gain. That is
functional but the initial step is larger than intended. Recommended starting
DAC-side constants are 0.85 V idle, 0.92 V start, and 3.25 V maximum, producing
about 1.08 V, 1.17 V, and 4.14 V respectively. Calibrate left and right with
the wheels lifted and a meter; clamp firmware output below the measured 4.2 V
controller limit and require a valid command lease before leaving idle.

`U6`–`U9` are Panasonic AQY212SX PhotoMOS relays. Each `J_*BRK` or `J_*REV`
terminal is a floating, polarity-independent two-wire normally-open contact;
neither terminal is carrier ground. The input side uses a 330 Ω LED resistor and
100 kΩ pull-down, and the output side has a removable normally-open `JP_*`
enable shunt. Copper-free moats on both PCB layers preserve the package's input
to output barrier. Panasonic rates the part for a 60 V peak load, 0.5 A
continuous load, and 1.5 kVrms I/O isolation, while recommending no more than
48 V in normal operation. Before connecting a controller pair, measure it open
circuit and confirm it is a low-current switch input below 48 V; these contacts
must never switch motor phase, battery, or accessory power.

PhotoMOS contacts prevent either brake/reverse wire from being assumed to be
ground, but they do not galvanically isolate the entire motor controller because
the throttle and Hall-tap interfaces intentionally share controller ground.
Runtime reverse must remain disabled unless the exact controller harness has a
connector explicitly labelled `Reverse`; never use the self-learning connector
as reverse. Leave all four `JP_*` shunts open until the matching pair has been
identified and bench-tested with its wheel lifted.

The Hall inputs are passive taps. Keep every motor's Hall connector attached to
its WinXu controller, join controller Hall ground to carrier ground, and tap only
the three signal wires through the carrier dividers. Do not route motor phase
wires alongside Hall, ultrasonic, I2C, servo-signal, or ESP32 wiring.

## Bench validation before wheels touch the ground

1. Inspect polarity, component orientation, solder bridges, ESP32 orientation,
   all three fuse holders, both DC-DC module footprints, four PhotoMOS relays,
   their isolation moats, and the protection-MOSFET area under magnification.
   With all fuse links removed, verify F1 opens battery positive, F2 opens both
   Pi-positive pins, and F3 opens the servo/auxiliary 24 V rail; none may have a
   bypass path.
2. With no ESP32, Pi, motor controllers, LEDs, or servo installed, use a
   current-limited supply at 36 V. Confirm `VIN_PROTECTED`, then confirm the 5 V
   rail starts near 5.10 V and the servo rail starts near 24.0 V. Repeat at 42 V.
3. Load the 5 V rail electronically at 0.5 A, 1 A, 3 A, and 5 A for at least ten
   minutes per step. If stable, continue toward 8 A at 36 V; qualify no more
   than 9.8 A above 36 V because the trim-up must remain below 50 W. Separately
   load the 24 V rail at 0.5 A, 1 A, 2 A, and 2.5 A,
   then repeat the worst-case simultaneous 5 V/24 V load. Record input power,
   output voltage, ripple, and the temperatures of PS1, PS2, F1–F3, Q5/Q6,
   output capacitors, connector pins, and the hottest copper. Stop on smoke,
   odor, oscillation, unexpected resets, rail droop outside the module limits,
   or any component exceeding its rating. Repeat at the maximum expected
   enclosure ambient; do not rely on room-temperature open-bench results.
4. Install the ESP32 only. For standalone testing, disconnect USB and close
   `JP_ESP_PWR`; for Pi USB testing, open `JP_ESP_PWR` before connecting the
   cable. Confirm the selected source appears at VIN, confirm 3.3 V at the ESP32
   rail, normal boot/logs, flashing, Pi commands in both directions, and battery
   readings near 36 V and 42 V. With controller power still disconnected,
   verify each enabled PhotoMOS pair changes from open to low resistance only
   for its own command, and all throttle and brake/reverse commands are inactive
   during reset and command-lease timeout.
5. Power Hall sensors/controllers with both wheels lifted. Turn each wheel by
   hand and confirm only valid Hall states 1–6, no skipped transitions, and 90
   transitions per mechanical revolution before trusting speed/distance.
6. Test one motor/controller at a time at the smallest demand. First measure the
   controller's brake/reverse pair voltage and current, then verify forward,
   stop, physical emergency-stop, isolated brake, and only then labelled reverse.
   Before enabling a wheel, sweep each DAC while watching the corresponding
   controller signal with a meter: confirm about 1.08 V at idle, no step above
   the configured start value, monotonic response, and a hard clamp below 4.2 V.
7. Add ultrasonic sensors one at a time in trigger/echo mode. Confirm each
   buffered TRIG output reaches approximately 5 V, each echo GPIO remains
   below 3.3 V, pings are at least 60 ms apart, and the front sensor uses the
   migrated GPIO33 echo input.
8. Add RGB pixels with a current limit and brightness cap. Add the servo last;
   first verify its 24 V rating and polarity, then test no-load movement and
   worst-case stall while watching both rails and ESP32 resets. Scope the 24 V
   rail during fast deceleration; repeated or sustained rises toward the TVS
   breakdown region require a servo-rated regenerative clamp or dump load.

The emergency stop or keyed controller-enable circuit must remove controller
power independently of the ESP32, Pi, firmware, and network connection.

The board has six 3.2 mm non-plated M3 mounting holes. Four are true corner
mounts at (5,5), (125,5), (5,186), and (125,186) mm: a 120 × 181 mm mounting
pattern with every center 4 mm from the 128 × 189 mm outline. Each corner has a
7 × 7 mm copper-free screw/washer keepout on both layers. `H3`/`H4` remain as
interior supports for the long sensor/ESP32 section. Use insulating standoffs
and keep screw heads and washers inside the marked keepouts.

## Manufacturing status

`BOM_JLCPCB.csv` is now the v3 procurement/assembly list and includes the
protection stage, both THT DC-DC modules, 12 kΩ Hall dividers, six 10 nF Hall
filters, trigger/RGB buffers, RGB cable resistor and bulk capacitor, four
PhotoMOS contacts, battery sensing, the TLV9002 full-range throttle stage, UWS
trim resistor, 50 V servo capacitor/TVS, all three fuse holders, and suggested
manufacturer part numbers. `CPL_JLCPCB.csv` is regenerated from the PCB and
contains all 79 SMT placements. Through-hole parts,
ESP32 sockets, removable fuse links, Mini-Fit mating hardware, controller output
terminals, and enable shunts require manual procurement/assembly as noted in the
BOM. Distributor/LCSC availability is not
guaranteed; the assembler must confirm each suggested MPN, footprint overlay,
polarity, voltage rating, DC-bias/ripple performance, and substitution before
release.

References implemented as `WirePad`, the normally-open `JP_ESP_PWR` etched
solder jumper, and the six non-plated mounting holes are fabricated board
features and intentionally have no separate BOM part. The validation contract
requires every other fitted footprint to appear in the BOM and requires the CPL
to match the complete SMT-only footprint set exactly.

Every functional pad without a PCB net is explicitly allow-listed: the DevKit
`EN` socket pad (handled on the DevKit), LTC4367 `FAULT` output, and PS2
Remote/Trim. PS2 Remote is deliberately open because positive-logic open is
ON; its Trim pin is open for nominal output. PS1 Trim is connected only through
R44 to ground. Native KiCad reports zero
unconnected items, and the system validator fails if any additional functional
pad becomes unconnected.

The final native KiCad check is required to report **0 violations and 0
unconnected items**. The validation gate also rejects same-layer foreign-net
route crossings, missing Hall RC components, stale BOM/CPL content, an
under-width high-current 5 V path, fewer than six regulator-output vias, and
any ESP32 pin-map drift. It also locks the dual throttle gain/pinout, the 5.10 V
trim network, both controller-ground pads, the 24 V TVS, and the two-layer
ESP32 antenna keepout.

The carrier is generated directly as a PCB and currently has no matching KiCad
schematic, so KiCad ERC cannot independently prove the circuit. The executable
system contract, zero-violation native DRC, BOM/CPL, and fabrication outputs are
strong release gates, but they do not replace schematic capture, independent
peer review, exact-footprint overlay review, and a physical first-article load
test. Treat the first order as an engineering prototype, not as a validated
production run.

## Arduino-ESP32 example

`analogReadMilliVolts()` returns a calibrated millivolt reading, and 11 dB
attenuation comfortably covers the 1.44–1.68 V operating range. Espressif's
[Arduino ADC documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html)
describes both APIs and the ESP32 input ranges.

```cpp
#include <Arduino.h>

constexpr uint8_t kBatteryAdcPin = 34;
constexpr float kDividerScale = 25.0f;
constexpr float kCalibration = 1.0f;
constexpr float kUsableEmptyVolts = 36.0f;
constexpr float kUsableFullVolts = 42.0f;
constexpr size_t kSampleCount = 32;

float readBatteryVolts() {
    analogReadMilliVolts(kBatteryAdcPin);  // Discard the first conversion.

    uint32_t millivoltSum = 0;
    for (size_t sample = 0; sample < kSampleCount; ++sample) {
        millivoltSum += analogReadMilliVolts(kBatteryAdcPin);
        delayMicroseconds(250);
    }

    const float gpioMillivolts =
        static_cast<float>(millivoltSum) / kSampleCount;
    return gpioMillivolts * 0.001f * kDividerScale * kCalibration;
}

float usableBatteryPercent(float batteryVolts) {
    const float percent =
        100.0f * (batteryVolts - kUsableEmptyVolts) /
        (kUsableFullVolts - kUsableEmptyVolts);
    return constrain(percent, 0.0f, 100.0f);
}

void setup() {
    Serial.begin(115200);
    analogReadResolution(12);
    analogSetPinAttenuation(kBatteryAdcPin, ADC_11db);
}

void loop() {
    const float volts = readBatteryVolts();
    Serial.printf("Battery: %.2f V, usable estimate: %.0f%%\n",
                  volts, usableBatteryPercent(volts));
    delay(1000);
}
```

The percentage function is deliberately a 36–42 V usable-range estimate, not a
claim of exact lithium-ion state of charge. Pack chemistry, temperature, age,
cell imbalance, and voltage sag under motor load all change the relationship.
For better results, low-pass filter readings over several seconds and replace the
linear function with a lookup table measured on the actual pack under a known
load.

For one-point calibration, measure the protected battery rail with a trusted
multimeter while the firmware reports voltage, then set:

```text
kCalibration = multimeter voltage / reported voltage
```

ESP32 ADC reference voltage varies between chips. Espressif recommends the ADC
calibration driver for ESP-IDF applications; see the
[ESP-IDF ADC calibration guide](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/adc/adc_calibration.html).

## Regeneration and validation

Generate the final board and run the complete local release gate with KiCad 10:

```sh
node scripts/add-esp32-carrier-v3-battery-sense.mjs
kicad-cli pcb drc --refill-zones --save-board --exit-code-violations \
  -o /tmp/esp32-carrier-v3-drc.rpt \
  fixtures/esp32_robot_carrier/esp32_robot_carrier_v3.kicad_pcb
node scripts/sync-esp32-carrier-v3-b64.mjs
node scripts/validate-esp32-carrier-v3-battery-sense.mjs
node scripts/validate-esp32-carrier-v3-system.mjs
node scripts/validate-esp32-carrier-v3-routing.mjs
node scripts/export-esp32-carrier-v3-fabrication.mjs
node scripts/validate-esp32-carrier-v3-fabrication.mjs
```

`add-esp32-carrier-v3-battery-sense.mjs` is the top-level release generator. The
older `finalize-esp32-carrier-v3.mjs` is an internal stage called by the routing
chain and must not be used as the final release entry point. The v3 GitHub
workflow runs the same contract before KiCad zone refill, native DRC review,
and fabrication export. The generated `.kicad_pcb`, compressed copy, and
fabrication package are build products; the scripts remain the source of truth.
