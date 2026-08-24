# Alpha 0x Building: quarry

## Basic Info
- **ID**: quarry
- **Name**: Каменоломня
- **Era**: Stone Age (Era 0)
- **Cost**: 12 wood
- **Workers**: 3 per shift
- **Daily Output**: +1.0 stone per day
- **Special**: Stone extraction from nearby hill tiles
- **Tile Requirement**: Must be placed adjacent to TILE.HILL tile
- **Evolves Into**: quarry (upgraded), stone works, mine

## Alpha 0x Logic Enhancements

### 1. Stone Quarrying System
- **Quarry Radius**: 3-tile radius from building, must include hill tile
- **Daily Yield**: 1.0 stone per 3 workers — essential for construction, walls, wonders
- **Hill Sustainability**:
  - For every 15 stones extracted, hill loses 1 "layer" permanently
  - Hills have 3 layers — after 3 full extractions, tile reverts to grass/sand
  - Reforestation/regeneration: Rare events can restore one hill layer
- **Biome Variations**:
  - **Mountain**: +40% stone yield, harder to extract (requires more workers)
  - **Hill**: Standard yield (1.0 stone/day)
  - **Foothill**: +20% stone yield, easier extraction
  - **Valley**: -50% stone yield, few hills available

### 2. Evolution Path (Alpha 0x Upgrade System)
The quarry can evolve into **4 different directions** based on technology and extraction methods:

#### Evolution A: Stone Pit (requires `masonry` technology)
- **New Name**: Каменная кладка
- **Cost**: 15 wood + 8 stone (increased from 12 wood)
- **Workers**: 4 (increased from 3)
- **Daily Output**: +2.0 stone per day (increased from 1.0)
- **Special**: Systematic quarrying — deeper extraction, better organization
- **Visual**: Terraced pits, tool sheds, stone processing area
- **Unlock**: Available after masonry tech (era 1)

#### Evolution B: Mine (requires `bronze` technology)
- **New Name**: Шахта
- **Cost**: 25 wood + 10 stone (increased from 15 wood+stone)
- **Workers**: 4 (same)
- **Daily Output**: +1.6 stone per day + chance for "rich vein" discovery
- **Special**: Deep shaft mining — reaches underground veins, 60% more yield, but deeper excavation
- **Visual**: Shaft entrance, ore carts, processing facilities, support beams
- **Unlock**: Available after bronze tech (era 2)

#### Evolution C: Quarry Workshop (requires `pottery` technology)
- **New Name**: Кладкаatelier
- **Cost**: 18 wood + 12 stone
- **Workers**: 3
- **Daily Output**: +1.2 stone + +0.2 knowledge per day
- **Special**: On-site stone working — immediate shaping for construction, reduces transport needs
- **Visual**: Carving tools, finished stone blocks, storage for cut stone
- **Unlock**: Available after pottery tech (bronze era)

#### Evolution D: Open-Pit Mine (requires `steam` technology)
- **New Name**: Открытая шахта
- **Cost**: 80 stone + 40 gold + 20 steel (industrial era)
- **Workers**: 6 (increased from 3-4)
- **Daily Output**: +5.0 stone per day (5× original)
- **Special**: Large-scale open-pit mining — mechanized extraction, 24/7 operation with steam power
- **Visual**: Massive excavation, conveyor belts, processing plant, dust clouds
- **Unlock**: Available after steam tech (era 6)

### 3. Alpha 0x Interactions

#### With Other Buildings
- **Quarry + Stone House**: Direct supply — stone house construction speed +30% when quarry adjacent
- **Quarry + Masonry-related buildings**: Shared knowledge — advanced buildings gain +10% speed with adjacent quarry
- **Quarry + Depot**: Stone storage — depot capacity increased by 200 when quarry provides steady stream
- **Quarry + Foundry**: Steel production input — foundry stone consumption reduced by 25% when quarry adjacent
- **Quarry + University**: Educational — students study stone properties, +0.1 knowledge/day per quarry

#### With Buildings That Use Stone as Input
- **Granary**: Stone reinforcement — +100 food storage cap when stone supplied
- **Woodshed**: Stone foundation — wooden storage lasts 2× longer with stone base
- **Depot**: Core storage — primary resource warehouse
- **Smithy**: Fuel source — stone + fuel increases smelting speed +15%
- **Aqueduct**: Channel construction — stone blocks for water channels

#### With Events
- **Quake event**: Nearby quarry activates — +50% stone yield for 5 days, but risk of building damage
- **Rich Vein Discovery**: Random event — quarry finds exceptionally rich deposit +300% yield for 10 days
- **Stone Theft**: Rival faction steals 30% stored stone — relation penalty
- **Mining Collapse**: Rare collapse — building destroyed, population trapped (rescue event)

### 4. Gameplay Balance & Alpha 0x Tuning

#### Early Game Impact (Days 1-50)
- **Stone production**: 1.0 stone/day per quarry — slow but steady foundation
- **Construction material**: Essential for stone houses, walls, monuments
- **Competing costs**: Quarry (12 wood) vs forager (8 wood) vs lumber (10 wood) — early game prioritization

#### Mid-Game Transition (Days 50-150)
- **Tech unlock decision**: Masonry vs bronze vs pottery — each offers different stone production path
- **Evolution timing**: Stone pit for consistent output, mine for higher yield, workshop for knowledge+stone
- **Population-work balance**: 3-4 workers per quarry — affects available worker pool

#### Late Game (Days 150+)
- **Quarry obsolescence**: Original 1.0 stone/day becomes insufficient for large construction projects
- **Evolved versions remain relevant**:
  - **Stone pit** (2.0 stone) — useful through medieval for smaller projects
  - **Mine** (1.6 stone + rich veins) — military/construction focused
  - **Workshop** (1.2 stone + knowledge) — knowledge-focused civilizations
  - **Open-pit mine** (5.0 stone) — modern era massive infrastructure projects
- **Strategic layer**: Players may maintain multiple quarry types for different construction needs (housing, walls, wonders, industrial)

### 5. Alpha 0x Visual & Audio

#### Evolution Visuals
- **Original quarry**: Simple pit, tools, dirt piles, basic shelter
- **Stone pit**: Terraced sides, tool sheds, processed stone stacks, organized layout
- **Mine**: Shaft entrance, ore carts, underground tunnels, support beams visible
- **Workshop**: Carving tools, finished blocks, storage for cut stone, artisan tools
- **Open-pit mine**: Massive excavation, conveyor belts, processing plant, large-scale machinery

#### Seasonal Appearance
- **Spring**: Melting snow reveals new stone areas, increased activity after winter
- **Summer**: Peak production, dust clouds, active work zones
- **Autumn**: Harvest stone, preparation for winter, reduced activity
- **Winter**: Snow-covered pits, reduced output, frozen ground makes extraction harder

#### Sound Effects
- Picks and axes striking stone
- Cart wheels on rough ground
- Dust and grit sounds
- Shaft echoing (mines)
- Conveyor belt mechanical sounds (open-pit)

### 6. Alpha 0x AI Integration

#### Worker AI Priorities
1. **Stone extraction**: Primary task — mine stone within radius
2. **Transport**: Carry stone to storage or directly to construction sites
3. **Tool maintenance**: Repair picks/axes when worn (20% chance per season for original, lower for evolutions)
4. **Rest**: Return to rest at day's end if energy < 30%

#### Hill AI
- **Layer tracking**: AI monitors hill "depth" — each extraction removes one layer
- **Regrowth attempts**: Random chance each season to restore one layer (very rare)
- **Animal habitat**: Healthy hills support mountain goats, grazing animals — hunters benefit
- **Stability monitoring**: Over-extraction risks landslides — building safety warning

#### RNG Seed Integration
- Quarry seed determines **hill distribution** on new maps
- Hill clustering vs spread affects city placement and defense patterns
- Biome types create different economic specializations (mountain nations vs hill empires)
- Regrowth patterns create long-term map resource evolution

### 7. Alpha 0x Achievements & Milestones

#### Building Milestones
- **First Stone**: Build quarry and collect 10 stone
- **Deep Miner**: Evolve to mine
- **Stone Artisan**: Evolve to workshop (knowledge output)
- **Industrial Extraction**: Build open-pit mine and produce 100 stone/day
- **Sustainable Quarry**: Maintain quarry through 100+ days without hill depletion

#### Stone Resource Milestones
- **Foundation Stone**: Accumulate 50 stone (enough for 5 stone houses)
- **Wall Builder**: Use 100 stone for perimeter walls
- **Wonder Material**: Accumulate 500 stone for world wonders
- **Trade Resource**: Export 200 stone to other factions

### 8. Alpha 0x Modding Support

#### Extendable Properties
Modders can add:
- **New evolution paths** via `evolve` property
- **Biome modifiers** via `biome` property [mountain, hill, foothill, valley]
- **Yield adjustments** via `yield_modifier` property
- **Layer tracking** via `hill_layers` property (default 3)

#### Example Mod Addition
```javascript
// Modder-added quarry variant
quarry_deep: {
  name: 'Глубокая шахта',
  cost: { wood: 20, stone: 15 },
  workers: 5,
  out: { stone: 2.0 },
  biome: 'mountain',
  special: 'deep_vein',
  req: 'bronze',
  desc: '+100% stone yield in mountains, chance to find rich veins'
}
```

#### Hill Regeneration System
```javascript
// Modder-created hill restoration
hill_restoration: {
  name: 'Программа рекультивации',
  special: 'regeneration',
  effect: 'hill_layer_restore',
  value: 0.05,  // 5% chance per season to restore one layer
  radius: 10
}
```

### Summary
The Alpha 0x **quarry** provides the **structural foundation** for civilization — stone for housing, walls, monuments, and industry. The evolution from simple pits to deep mines and open-pit operations mirrors humanity's mastery over geology and rock manipulation. Each variant offers distinct strategic flavor: the eco-conscious stone pit, the militaristic mine, the knowledge-workshop, or the industrial open-pit — allowing players to shape their civilization's relationship with the earth beneath their feet.

*From hillside pit to deep mine — the stone that builds civilizations, evolved through Alpha 0x intelligence.*