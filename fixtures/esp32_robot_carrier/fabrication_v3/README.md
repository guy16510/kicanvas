# Trashbot v1 carrier fabrication package

`esp32_robot_carrier_v3-gerbers.zip` is the PCB-fabrication upload. It contains
only the two copper layers, top and bottom solder mask, top paste, top
silkscreen, board profile, Gerber job file, and combined plated/non-plated drill
file. The package is for a 2-layer, 1.6 mm FR-4 board measuring 128 mm × 189 mm,
with **2 oz (0.07 mm) copper on both outer layers**. Do not accept a 1 oz order
default; verify the fabricator's order summary before payment.

Final package SHA-256:

```text
7e7f8fb2b8122080db3f9910c25dc37bf87a1ee1921d0303cdc64ad9e314721c  esp32_robot_carrier_v3-gerbers.zip
```

The ZIP intentionally has nine files and no courtyard, margin, drawing-sheet,
or bottom-silkscreen layer. Upload the ZIP as the bare-board package. Use the
parent `BOM_JLCPCB.csv` and `CPL_JLCPCB.csv` only for assembly quotation; review
every suggested part and substitution before accepting it. The two power
modules, ESP32 sockets, connectors, fuses/holders, radial capacitors, MOSFETs,
and other parts marked Hand/THT are not represented by SMT placement rows.

The four outer M3 NPTH centers form a 120 mm × 181 mm corner mounting pattern
at (5,5), (125,5), (5,186), and (125,186) mm. Two additional interior M3 NPTH
holes support the sensor/ESP32 region.

`BOM_JLCPCB.csv` and `CPL_JLCPCB.csv` remain one directory above this package.
Through-hole connectors, all three fuse holders and fuse links, both power
modules, ESP32 sockets, Mini-Fit hardware, TO-220 protection MOSFETs, radial
capacitors, output terminal blocks, and enable shunts require manual assembly as
identified in the BOM.

This is an engineering-prototype release, not a substitute for first-article
inspection and the staged power, thermal, controller, Hall, ultrasonic, RGB,
servo, and fail-safe tests in the parent README. Do not enable a wheel on the
ground during first power-up.
