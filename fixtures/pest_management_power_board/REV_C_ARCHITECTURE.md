# Rev C architecture: ultra-budget 2S USB-C insect-zapper carrier

## Design target

Rev C is now optimized for a cheap hobby build rather than premium power electronics. The PCB remains a low-voltage carrier/interface board. The high-voltage source is still a sealed, prebuilt commercial insect-zapper module; its internal HV circuitry is not reproduced on the PCB.

Target philosophy: spend money only where it materially affects function. Use commodity daughterboards, direct solder pads, common electrolytics and a replaceable fuse.

## Budget power chain

1. **Battery:** 2S 18650 pack, 7.4 V nominal / 8.4 V full, with an inexpensive 2S protection/BMS board.
2. **USB-C charging:** generic 5 V USB-C to 8.4 V 2S CC/CV charger daughterboard. A TP5100-class 2S charging module is an acceptable hobby reference if the actual module explicitly supports 2S / 8.4 V charging.
3. **Fuse:** inexpensive replaceable 5x20 mm fuse on the HV-load path. Start conservatively around 2 A while the cells are unidentified.
4. **Switch:** inexpensive panel-mount momentary switch on the low-voltage side.
5. **Transient support:** one 1000-2200 uF electrolytic close to the HV module input. A second bulk capacitor is optional only if supply sag is observed.
6. **Voltage conversion:** omit it whenever possible. Prefer a sealed HV zapper module whose input range includes the 2S battery voltage. If conversion is unavoidable, use a commodity XL6009-class boost module or LM2596-class buck module selected to match the HV module input.
7. **HV converter:** generic potted insect-killer / mosquito-zapper high-voltage module in the roughly 3-6 kV class, selected for low cost, compatible input voltage and good recovery when the mesh is loaded. Ignore marketplace '400kV/1000kV' naming as a meaningful electrical specification.
8. **Grid:** direct insulated flying leads or widely separated solder/terminal landing points.

## What was removed from the expensive Rev C concept

- Analog Technologies 5 kV / 10 W converter: removed.
- Pololu high-current 12 V boost converter: removed.
- Premium Panasonic/Nichicon/WIMA parts as requirements: removed.
- Industrial terminal blocks everywhere: removed where direct solder pads are sufficient.
- Dual 2200 uF capacitor bank as a requirement: reduced to one inexpensive bulk capacitor, with a second footprint optional.
- Integrated production-grade USB charging IC design: replaced by a cheap serviceable daughterboard.

## Cost target

Typical hobby-marketplace target, excluding cells, mesh and enclosure:

- USB-C 2S charger module: roughly $1-3 class
- 2S BMS: roughly $1 class
- optional commodity buck/boost module: roughly $1-3 class
- potted insect-zapper HV module: roughly $3-8 class
- fuse, switch, capacitors, connectors/wire: a few dollars
- small PCB: low single-digit dollars in quantity from budget fabs

The intended electronics BOM is therefore roughly **$10-20**, depending mostly on the chosen HV module and whether a separate DC/DC converter is needed.

## USB-C charging rule

Charge with the HV system switched off. The charger module only needs to charge the 2S pack; it does not need to power the insect grid while USB is connected.

## Layout strategy

The existing Rev C carrier geometry keeps the low-voltage region separate from the HV output region and retains a routed isolation slot. Commodity modules should be attached with short low-voltage wiring and insulated HV flying leads rather than forcing unknown marketplace board dimensions into the PCB footprint.

## Battery note

The charger and BMS do not turn damaged or badly mismatched cells into a safe pack. For a hobby build, at minimum use two cells of the same chemistry and approximately similar capacity/state of health, and discard cells that heat excessively or show abnormal voltage behavior.
