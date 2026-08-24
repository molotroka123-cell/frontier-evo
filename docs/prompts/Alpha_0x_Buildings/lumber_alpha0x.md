# Alpha 0x Building: lumber

## Basic Info
- **ID**: lumber
- **Name**: Лесопилка
- **Era**: Stone Age (Era 0)
- **Cost**: 10 wood
- **Workers**: 3 per shift
- **Daily Output**: +1.2 wood per day
- **Special**: Wood harvesting from nearby forest tiles
- **Tile Requirement**: Must be placed adjacent to TILE.FOREST tile
- **Evolves Into**: lumber (upgraded), forestry station

## Alpha 0x Logic Enhancements

### 1. Forest Harvesting System
- **Harvest Radius**: 3-tile radius from building, must include forest tile
- **Daily Yield**: 1.2 wood per 3 workers — sufficient for ~2-3 buildings per day
- **Forest Sustainability**: 
  - For every 10 buildings harvested, 1 tree "regrows" per season (3 months)
  - Over-harvesting (more than 50% of nearby forest lost) reduces yield by 30%
  - Reforestation events can occur randomly or via player action
- **Biome Variations**:
  - **Taiga**: +20% wood yield, longer regrowth time
  - **Temperate Forest**: Standard yield (1.2 wood/day)
  - **Jungle**: +30% wood yield, faster regrowth (2× speed)
  - **Desert Edge**: -50% wood yield, few trees available

### 2. Evolution Path (Alpha 0x Upgrade System)
The lumber camp can evolve into **4 different directions** based on technology and resource availability:

#### Evolution A: Advanced Lumber Mill (requires `masonry` technology)
- **New Name**: Косилка с водяной мукой
- **Cost**: 15 wood + 5 stone (increased from 10 wood)
- **Workers**: 4 (increased from 3)
- **Daily Output**: +2.0 wood per day (increased from 1.2)
- **Special**: Water-powered mill — consistent output regardless of forest density
- **Visual**: Water wheel, processing shed, stacked lumber piles
- **Unlock**: Available after masonry tech (era 1)

#### EvolutionB: Sustainable Forestry (requires `pottery` technology)
- **New Name**: Устойчивая лесопилка
- **Cost**: 12 wood + 8 stone
- **Workers**: 3 (same)
- **Daily Output**: +1.5 wood per day
- **Special**: Reforestation program — plants 1 tree for every 3 harvested, sustainable yield
- **Visual**: Tree saplings, fenced areas, marker stones
- **Unlock**: Available after pottery tech

#### Evolution C: Tar Pit (requires `gunpowder` technology)
- **New Name**: Терийная яма
- **Cost**: 20 wood + 15 stone + 5 gold
- **Workers**: 4
- **Daily Output**: +1.8 wood + 0.3 tar per day
- **Special**: Produces tar from wood residue — used for waterproofing, adhesives, later road paving
- **Visual**: Smoke pit, tar collection vats, storage barrels
- **Unlock**: Available after gunpowder tech (era 4)

#### Evolution D: Nano-Forestry (requires `robotics` technology)
- **New Name**: Нанолесопилка
- **Cost**: 100 steel + 50 gold + 30 stone (future tech)
- **Workers**: 0 (automated)
- **Daily Output**: +5.0 wood per day (4× original, automated)
- **Special**: Drones harvest trees, replant saplings, zero labor cost, 24/7 operation
- **Visual**: Drone swarms, automated processing, reforestation robots
- **Unlock**: Available after robotics + AI era (era 9-10)

### 3. Alpha 0x Interactions

#### With Other Buildings
- **Lumber + Mine**: Shared workers — miners can work lumber shifts during off-seasons
- **Lumber + Barracks**: Wood for weapons — barracks receive +50% wood supply for weapon maintenance
- **Lumber + Workshop**: Production input — workshop wood consumption reduced by 20% when lumber adjacent
- **Lumber + Granary**: Food storage — wood crates double as winter fuel (emergency food ×0.5)
- **Lumber + Market**: Surplus wood sold — generates gold based on market price fluctuations

#### With Buildings That Use Wood as Input
- **Mill**: Wood consumption reduced by 15% when lumber adjacent
- **Workshop**: Wood consumption reduced by 20% when lumber adjacent
- **Smithy**: +10% production speed with adequate wood supply from lumber
- **Apartment**: Wood decorative elements — +1 happiness per 2 lumber mills in city

#### With Events
- **Windfall event**: Storm knocks down trees — +50% immediate wood yield for 5 days, then -30% regrowth
- **Beetle Infestation**: Reduces forest health — 20% yield reduction for 15 days
- **Fire Event**: Forest fire risk — lumber may be destroyed if too close, but provides emergency wood
- **Monsoon Season**: Jungle lumber +50% yield, taiga -20% yield

### 4. Gameplay Balance & Alpha 0x Tuning

#### Early Game Impact (Days 1-50)
- **Wood production**: 1.2 wood/day per mill — modest but essential early game resource
- **Wood cost competition**: Lumber (10 wood cost) vs hut (6 wood) vs campfire (free) — early game economy priority
- **Map exploration**: Lumber requires forest proximity — influences settlement placement

#### Mid-Game Transition (Days 50-150)
- **Tech unlock decision**: Masonry vs pottery vs gunpowder — each offers different wood production path
- **Evolution timing**: Water mill for consistent production, sustainable for eco-players, tar pit for industrial/war focus
- **Population-work balance**: 3 workers per mill — affects available worker pool for other buildings

#### Late Game (Days 150+)
- **Lumber camp obsolescence**: Original 1.2 wood/day becomes negligible
- **Evolved versions remain relevant**:
  - **Water mill** (2.0 wood) — useful through medieval with water source
  - **Sustainable forestry** (1.5 wood + eco bonus) — environmentally-focused civilizations
  - **Tar pit** (1.8 wood + tar) — war/industrial focused
  - **Nano-forestry** (5.0 wood, 0 workers) — post-scarcity, fully automated
- **Strategic layer**: Players may maintain multiple evolution types for different purposes (construction, maintenance, production, automation)

### 5. Alpha 0x Visual & Audio

#### Evolution Visuals
- **Original lumber camp**: Simple clearing, axes, stacked wood, basic shelter
- **Water mill**: Water wheel flowing, mill building, planks processed, water channel
- **Sustainable forestry**: Saplings planted, fenced areas, monitoring markers, balanced harvest
- **Tar pit**: Smoke, tar vats, storage barrels, industrial appearance
- **Nano-forestry**: Drone swarms, automated processing units, 3D printed wood products, glowing indicators

#### Seasonal Appearance
- **Spring**: New growth visible, mud around pits, increased activity
- **Summer**: Full growth, wood stacks drying, high activity
- **Autumn**: Harvest coloration, wood processed, preparation for winter
- **Winter**: Snow-covered, reduced activity, insulated structures, frozen ground

#### Sound Effects
- Axe chopping wood sounds
- Water wheel creaking/moving
- Sawing and processing sounds
- Tar bubbling and sizzling
- Drone hum (nano-forestry)

### 6. Alpha 0x AI Integration

#### Worker AI Priorities
1. **Wood gathering**: Primary task — harvest wood within radius
2. **Processing**: Bring wood to storage or processing building
3. **Tool maintenance**: Repair axes/saws when worn (15% chance per season for original, lower for evolutions)
4. **Rest**: Return to rest at day's end if energy < 30%

#### Forest AI
- **Regrowth simulation**: AI tracks harvested area, schedules regrowth based on biome type
- **Disease spread**: Forest can "sicken" if over-harvested — reduced yields, eventual death
- **Fire risk**: Dry summer + lightning = forest fire chance — affects nearby buildings
- **Animal habitat**: Healthy forests support animal populations — hunters benefit

#### RNG Seed Integration
- Lumber seed determines **forest distribution** on new maps
- Forest clustering vs spread affects settlement patterns and trade routes
- Biome types create different economic specializations (jungle nations vs taiga empires)
- Regrowth patterns create long-term map evolution

### 7. Alpha 0x Achievements & Milestones

#### Building Milestones
- **First Wood**: Build lumber mill and collect 20 wood
- **Master Woodcutter**: Evolve to water mill
- **Eco-Manager**: Evolve to sustainable forestry (no depletion)
- **Industrial Tar**: Build tar pit and produce 50 tar
- **Automated Forest**: Evolve to nano-forestry (0 workers)

#### Wood Resource Milestones
- **Wood Stockpile**: Accumulate 200 wood
- **Construction Supply**: Use 100 wood for building projects
- **Weapon Production**: Supply 50 weapons from wood resources
- **Trade Empire**: Export 200 wood to other factions

### 8. Alpha 0x Modding Support

#### Extendable Properties
Modders can add:
- **New evolution paths** via `evolve` property
- **Biome modifiers** via `biome` property [taiga, temperate, jungle, desert]
- **Yield adjustments** via `yield_modifier` property
- **Regrowth timers** via `regrowth_days` property

#### Example Mod Addition
```javascript
// Modder-added lumber variant
lumber_tropical: {
  name: 'Тропическая пилинговая',
  cost: { wood: 12, gold: 5 },
  workers: 4,
  out: { wood: 1.8 },
  biome: 'jungle',
  special: 'fast_regrowth',
  regrowth_days: 15,  // 2× faster than default
  desc: '+80% wood yield in jungles, trees regrow twice as fast'
}
```

#### Forest Disease System
```javascript
// Modder-created forest disease
forest_blight: {
  name: 'Черное дерево',
  special: 'disease',
  effect: 'yield_reduction',
  value: 0.5,  // 50% yield reduction
  spread_rate: 0.1,  // 10% per season to adjacent forests
  cure: 'research:plant_pathology'
}
```

### Summary
The Alpha 0x **lumber** building transforms raw forest resources into structured wood production that fuels every aspect of civilization development. From axes and simple camps to water-powered mills and automated drone forests, the evolution path reflects humanity's relationship with nature — from exploitation to sustainable management to technological mastery. The modular design ensures every player finds a wood management style matching their civilization's values and strategic needs.

*From standing forest to processed lumber — the backbone of every civilization's construction and industry.*