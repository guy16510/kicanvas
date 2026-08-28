# Pest Management Power Distribution Board

Rev B KiCad fixture for a low-voltage battery/control board that interfaces to a sealed commercial high-voltage DC/DC module used with a three-layer insect mesh.

## Rev B design goal

The battery source is treated as a protected 2S pack with **unknown cell current capability**. The PCB is therefore designed to minimize low-voltage losses and support short module-input transients, while a replaceable input fuse deliberately limits battery current.

This revision does **not** assume miscellaneous 18650 cells are safely capable of 5 A. Do not assemble unmatched loose cells into a 2S pack. Use a BMS/protected pack and begin with the conservative fuse value in the BOM.

## Electrical architecture

- Protected 2S Li-ion input, 7.4 V nominal / 8.4 V fully charged
- F1: 5x20 mm fast fuse, **start at 2 A** because cell capability is unknown
- SW1: panel-mounted momentary switch with an oversized low-resistance DC current path
- C1 + C2: two 2200 uF / 16 V low-ESR capacitors in parallel at the HV-module input
- C3: 1 uF / 25 V fast bypass capacitor across the switched module input
- Total bulk capacitance: nominal 4400 uF
- 3.0 mm low-voltage power traces to reduce distribution loss
- J2, 4-position isolated landing interface to a sealed commercial HV module
  - Pin 1: +7.4V_SW
  - Pin 2: GND
  - Pin 3: HV_POS
  - Pin 4: HV_NEG
- J3: HV_POS external mesh terminal
- J4: HV_NEG external mesh terminal

## What the larger capacitor bank does

The C1/C2 bank does not create additional sustained power. It stores a small amount of energy locally and can reduce battery-voltage sag during a short input-current transient from the commercial HV module. Sustained output power is still limited by the cells, BMS, fuse and module efficiency.

At 8.4 V, 4400 uF stores roughly 0.16 joule. At 7.4 V it stores roughly 0.12 joule. This is useful as a local transient reservoir, not as a substitute for a higher-power battery pack.

## PCB constraints

- `LV_Power`: battery, fuse, switch, capacitor bank, module input and return
- `HV_Grid`: commercial module HV output to J3/J4
- `HV_Grid` minimum clearance: 10.0 mm
- HV_POS and HV_NEG run in separate straight corridors
- A 2 mm-wide routed Edge.Cuts slot runs between the two HV corridors
- LV routing is kept left of the HV_POS corridor with >10 mm intended copper-edge spacing

## Power strategy with the same batteries

1. Reduce resistance in the low-voltage path using larger pads, 3 mm traces and an oversized switch contact path.
2. Put low-ESR bulk capacitance physically close to the module input.
3. Let the fuse control maximum battery current. Start at 2 A with unknown cells.
4. The sealed commercial HV module remains the component that determines sustained mesh voltage/current and recovery rate.

## Safety note

The board does not generate high voltage. It only distributes low-voltage battery power and interfaces to a sealed, commercially manufactured high-voltage module. Actual HV connector ratings, spacing, enclosure design, touch protection, discharge behavior and compliance must be validated against the selected module's maximum output voltage and applicable product-safety standards before fabrication or use.

The PCB being physically capable of carrying several amps does not mean unknown 18650 cells can safely supply that current.
