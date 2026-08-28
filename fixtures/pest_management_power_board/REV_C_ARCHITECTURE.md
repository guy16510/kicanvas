# Rev C architecture: real 5 kV / 10 W supply + USB-C charging

## Design target

Rev C replaces the generic/advertised "1000KV" pulse module with a legitimately specified enclosed high-voltage DC/DC supply and adds USB-C charging for a protected 2S Li-ion pack.

The high-voltage converter is **not built on this PCB**. The board only handles low-voltage battery power, charging, switching, transient support, a 12 V boost stage, and isolated landing points for the sealed HV supply.

## Selected power chain

1. **Battery:** protected/balanced 2S Li-ion pack, 7.4 V nominal / 8.4 V full.
2. **USB-C charger:** 2S 8.4 V CC/CV charger from 5 V USB-C. Production-quality reference architecture: TI BQ25883/BQ25886 family. For the Rev C carrier PCB, CHG1 is a replaceable 39 x 18 mm 2S USB-C charger daughterboard footprint so the charger can be serviced independently.
3. **Fuse:** F1 on the discharge/HV path. Start with 2 A fast acting while cell capability is unknown.
4. **Switch:** heavy DC-rated momentary switch.
5. **Transient reservoir:** C1/C2 low-ESR bulk capacitors on the 2S rail, plus C3 bypass.
6. **12 V boost:** Pololu U3V70F12 or equivalent regulated 12 V boost module. It accepts the full 2S voltage range and has true shutdown, current limiting, reverse-voltage protection, short-circuit protection, and thermal protection.
7. **HV converter:** Analog Technologies **AHV12V5KV2MAW**, enclosed 11-13 V input, 5 kV output, 2 mA maximum, 10 W rated output.
8. **Grid:** separate HV+ and HV- terminals with the existing HV clearance/slot strategy.

## Why this is materially different from the "1000KV" module

The AHV12V5KV2MAW has a real specified load rating: 5,000 V at up to 2 mA, or 10 W. That makes the design target output power/recovery instead of open-circuit arc length or an implausible marketing voltage.

The expected low-voltage demand is roughly 14-16 W after allowing for the HV converter's published efficiency and the 12 V boost stage. From a 7.4 V pack that is approximately 2-2.5 A, depending on actual efficiency and load. Because the present cells are unidentified, Rev C retains a conservative 2 A starting fuse and requires a protected pack. If the converter repeatedly opens a 2 A fuse, the answer is to identify/use cells with a known discharge rating rather than silently increasing the fuse.

## USB-C charging

CHG1 is intentionally a module footprint rather than a hand-authored charger IC implementation. Requirements for the installed daughterboard:

- USB Type-C receptacle
- 5 V USB input
- 2S Li-ion CC/CV charge termination at 8.4 V
- 1 A charge current preferred for unidentified/older 18650 cells
- output to protected/balanced pack
- no requirement to run the HV system while charging

A production revision should replace CHG1 with a directly integrated charger based on TI's BQ25883/BQ25886 reference design after the battery cell type and pack architecture are fixed.

## Charging / operating rule

Rev C is intended to charge with the HV system switched off. Do not energize the insect grid while the USB-C cable is connected. This avoids coupling a grounded USB supply/host into a high-voltage appliance and avoids asking a small charger to support the HV load.

## HV layout

- Keep `HV_Grid` at >= 10 mm clearance as a project minimum.
- Keep HV+ and HV- in separate corridors.
- Maintain the routed isolation slot between HV output regions.
- Do not route USB, charger, battery, or 12 V copper into the HV region.
- Final clearance/creepage must still be checked against the exact 5 kV module, enclosure, contamination environment, altitude, connector system, and product-safety requirements.

## Battery warning

Do not make a permanent 2S pack from two random unmatched loose cells. Two series cells should be matched in chemistry, capacity, age, state of health, and state of charge, and managed by a 2S protection/balancing system. The charger does not make an unsafe or mismatched pack safe.
