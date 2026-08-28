# Rev C architecture: ultra-budget 2S USB-C insect-zapper carrier

## Design target

Rev C is optimized for a cheap hobby build rather than premium power electronics. The PCB remains a low-voltage carrier/interface board. The high-voltage source is still a sealed, prebuilt commercial insect-zapper module; its internal HV circuitry is not reproduced on the PCB.

Target philosophy: spend money only where it materially affects function. Use commodity daughterboards, direct solder pads, common electrolytics and a replaceable fuse.

A second design goal is **mesh-spacing flexibility**. If the physical distance between opposite-polarity meshes is increased later, the low-voltage section should remain largely unchanged. The parts that must be reconsidered are called out explicitly below.

## Budget power chain

1. **Battery:** 2S 18650 pack, 7.4 V nominal / 8.4 V full, with an inexpensive 2S protection/BMS board.
2. **USB-C charging:** generic 5 V USB-C to 8.4 V 2S CC/CV charger daughterboard. A TP5100-class 2S charging module is an acceptable hobby reference if the actual module explicitly supports 2S / 8.4 V charging.
3. **Fuse:** inexpensive replaceable 5x20 mm fuse on the HV-load path. Start conservatively around 2 A while the cells are unidentified.
4. **Switch:** inexpensive panel-mount momentary switch on the low-voltage side.
5. **Transient support:** one 1000-2200 uF electrolytic close to the HV module input. A second low-voltage bulk capacitor is optional only if supply sag is observed.
6. **Voltage conversion:** omit it whenever possible. Prefer a sealed HV zapper module whose input range includes the 2S battery voltage. If conversion is unavoidable, use a commodity buck/boost module selected to match the HV module input.
7. **HV converter:** generic potted insect-killer / mosquito-zapper high-voltage module, selected for low cost, compatible input voltage and good recovery when the mesh is loaded. Ignore marketplace '400kV/1000kV' naming as a meaningful electrical specification.
8. **Grid:** direct insulated flying leads or widely separated solder/terminal landing points.

## Mesh-spacing upgrade path

Increasing the spacing between opposite-polarity meshes changes the electric-field requirement. Do **not** treat a larger high-voltage capacitor as the normal response. The safe upgrade path is to reassess the operating voltage and all insulation-related components while keeping intentional energy storage on the low-voltage side.

### Parts that usually DO NOT change just because mesh spacing increases

- **CHG1 USB-C charger:** unchanged as long as the battery remains 2S.
- **2S BMS / battery protection:** unchanged unless the replacement HV module requires more battery current than the existing pack/BMS safely supplies.
- **C1/C2 low-voltage bulk capacitors:** remain on the 2S rail. Their purpose is input-sag reduction, not storing discharge energy on the mesh.
- **Control button / logic:** unchanged if it controls a MOSFET or enable input rather than carrying HV.

### Parts that MUST be rechecked when mesh spacing increases

1. **HV1 high-voltage module**
   - This is the first component to reconsider.
   - If the wider mesh spacing is no longer effective at the present operating voltage, replace HV1 with a purpose-built, current-limited insect-zapper module with an appropriately higher specified output voltage.
   - Do not select by advertised free-air arc length or fantasy '1000kV' marketplace labels.

2. **HV leads / wire insulation**
   - Must be rated for the selected HV module voltage with margin.
   - Replace them when moving beyond their voltage rating or if insulation condition is uncertain.

3. **HV connectors / solder landing points**
   - Their spacing, creepage and insulation need to remain suitable for the selected voltage.
   - Direct insulated flying leads are preferred for the inexpensive version because they avoid relying on low-voltage terminal blocks for HV.

4. **PCB clearance and isolation slot**
   - Recheck copper-to-copper clearance, creepage and the isolation slot whenever HV1's voltage is increased.
   - The present board geometry is not a blanket approval for arbitrary future voltage increases.

5. **Mesh supports and enclosure**
   - Insulating standoffs, frame material, contamination/wetness exposure and finger-access protection all need reevaluation at higher operating voltage.

6. **Optional low-voltage DC/DC module U1**
   - Only changes if the replacement HV module requires a different low-voltage input rail.
   - Example: if a later sealed HV module requires 12 V rather than direct 2S input, add/replace U1 with a converter that can supply the module's stated input power without excessive sag.

7. **Fuse / battery-current path**
   - Recheck only if the new HV module has a materially higher low-voltage input-current requirement.
   - Do not automatically increase fuse size. Battery cells, BMS, wiring, PCB copper and connectors must all support the new current first.

### What is intentionally NOT part of the upgrade path

Rev C does not use a large multi-kilovolt capacitor bank across the mesh. Increasing mesh spacing is **not** a reason to add HV pulse capacitors, SCR/IGBT dump stages, spark-gap discharge stages, or other charge-and-dump circuitry. Those change the device from a current-limited zapper toward a stored-energy discharge source.

## Practical upgrade sequence

When changing mesh spacing:

1. Change the mechanical spacing.
2. Evaluate whether the existing current-limited HV module remains effective without self-arcing or excessive sag.
3. If it does not, select an appropriately rated purpose-built HV module.
4. Recheck HV wire, connector/landing-point spacing, PCB clearance, standoffs and enclosure for the new voltage.
5. Check the new module's **low-voltage input current** against the 2S cells, BMS, fuse, switch/MOSFET, wiring and PCB copper.
6. Change the low-voltage DC/DC stage only if the new HV module requires a different input voltage.
7. Keep bulk capacitance on the low-voltage side.

This makes the replaceable **HV module + HV insulation system** the normal voltage-scaling boundary while the charger, battery architecture and controls remain reusable.

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
