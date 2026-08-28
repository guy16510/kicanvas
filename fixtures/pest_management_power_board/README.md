# Pest Management Power Distribution Board

KiCad design fixture for a low-voltage battery/control board that interfaces to a sealed commercial high-voltage DC/DC module.

## Electrical architecture

- 2-cell 18650 battery input, 7.4 V nominal
- F1, 5 A fast-acting series fuse
- SW1, momentary push-button switch rated for at least 5 A DC continuous load
- C1, 470 uF / 25 V bulk capacitor across switched VCC and GND
- J2, 4-pin interface to a sealed commercial HV module
  - Pin 1: +7.4V_SW
  - Pin 2: GND
  - Pin 3: HV_POS
  - Pin 4: HV_NEG
- J3: HV_POS external grid terminal
- J4: HV_NEG external grid terminal

## PCB constraints

Two logical routing classes are required:

- `LV_Power`: battery, fuse, switch, module input and return
- `HV_Grid`: module HV output to J3/J4

`HV_Grid` must use a minimum 10.0 mm clearance. The PCB includes an Edge.Cuts isolation slot between the HV_POS and HV_NEG output regions to increase creepage distance across FR4.

## Safety note

The board does not generate high voltage. It is only an interface to a sealed, commercially manufactured, isolated high-voltage module. Actual spacing, connector ratings, enclosure design, touch protection, discharge behavior and compliance must be validated against the selected module's maximum output voltage and applicable product-safety standards before fabrication or use.
