# Alpha 0x Building: hut

## Basic Info
- **ID**: hut
- **Name**: Хижина
- **Era**: Stone Age (Era 0)
- **Cost**: 6 wood
- **Housing**: 4 residents
- **Workers**: N/A (automatically assigned)
- **Evolves Into**: house (stone house) or cottage
- **Special**: Basic player housing — foundation of population growth

## Alpha 0x Logic Enhancements

### 1. Population Foundation Mechanic
- The hut is the **primary housing source** for early population growth
- Each hut accommodates **4 residents** — the maximum population cap early game
- Population growth formula: `pop_growth_per_day = (total_housing - current_pop) × 0.02`
- Without huts, population cannot exceed 6 (campfire only provides housing for 6 but no additional capacity)

### 2. Evolution Path (Alpha 0x Upgrade System)
The hut can evolve into **3 different directions** based on technology and resources:

#### Evolution A: Stone House (requires `masonry` technology)
- **New Name**: Каменный дом
- **Cost**: 10 wood + 18 stone (increased from 6 wood)
- **Housing**: 8 residents (doubled from 4)
- **Special**: Fireproof, lasts through winter without penalty
- **Visual**: Stone walls, wooden roof, chimney smoke
- **Unlock**: Available after researching masonry tech

#### Evolution B: Cottage (requires 10 population + 8 wood)
- **New Name**: Хутор
- **Cost**: 8 wood
- **Housing**: 6 residents (same as original but different bonus)
- **Special**: +1 food production from nearby farm (radius 2 tiles)
- **Visual**: Wooden extension with garden plot
- **Unlock**: Available when population reaches 10+ and farm tech researched

#### Evolution C: Apartment Unit (requires `electricity` technology)
- **New Name**: Эконом-апартамент
- **Cost**: 30 stone + 20 steel (modern materials)
- **Housing**: 20 residents (5× original capacity)
- **Special**: Powered — requires electricity connection, modern insulation
- **Visual**: Multi-story block with windows, solar panels
- **Unlock**: Available after electricity era (era 7)

### 3. Alpha 0x Interactions

#### With Other Buildings
- **Hut + Farm**: Residents can work farms — +0.1 food/day per hut-resident working fields
- **Hut + Story Fire (evolved campfire)**: Families gather — +1 happiness per 2 huts near fire
- **Hut + Barracks**: Soldier housing — trained units return to huts between battles, reducing upkeep
- **Hut + Mine/Quarry**: Worker housing — miners/stones Quarters provide +10% production when housed

#### With Seasons & Weather
- **Winter**: Hut provides **basic warmth** — residents inside don't suffer full winter food penalty (-25% → -10%)
- **Rain**: Hut residents stay dry — work productivity maintained at 100% vs 90% for exposed workers
- **Summer**: Hut shade provides — +0.5 happiness/day for residents working outdoors

#### With Events
- **Lost Child event**: Hut provides **safe spawn point** — missing children always found near their home hut
- **Old Master event**: Hut hosts visiting artisan — +30 knowledge if housing available
- **Spring Flood**: Elevated hut sites avoid flood penalty — no food loss if built on hill

### 4. Gameplay Balance & Alpha 0x Tuning

#### Early Game Impact (Days 1-30)
- **Housing capacity**: 4 per hut — allows population growth from starting 6 to 10-15 with 2-3 huts
- **Resource sink**: 6 wood cost — early game wood management decision
- **Strategic choice**: Player must decide — build more huts (housing) or other buildings (production)

#### Mid-Game Transition (Days 30-100)
- **Population pressure**: As tech unlocks more production buildings, housing becomes bottleneck
- **Evolution timing**: Key decision point — evolve to stone house for larger population, or cottage for food bonus
- **Tech prerequisites**: Masonry (era 1) vs cottage (population-based) offers different strategic paths

#### Late Game (Days 100+)
- **Hut obsolescence**: Original hut housing (4) becomes inadequate
- **Evolved versions remain relevant**:
  - **Stone house** (8 housing) — useful through medieval era
  - **Cottage** (6 housing + food bonus) — food-focused civilizations
  - **Apartment** (20 housing) — modern era high-density living
- **Strategic layer**: Players may maintain lower-level huts for specific biomes or map types

### 5. Alpha 0x Visual & Audio

#### Evolution Visuals
- **Original hut**: Log cabin, conical roof, smoke from chimney
- **Stone house**: Cut stone blocks, wooden roof beams, chimney with smoke
- **Cottage**: Wattle and daub, thatched roof, flower garden, small porch
- **Apartment**: Concrete/steel frames, large windows, balcony, modern design

#### Seasonal Appearance
- **Spring**: Green grass around hut, flowers planted
- **Summer**: Full growth, residents on porch/outside
- **Autumn**: Falling leaves, harvest decorations
- **Winter**: Snow on roof, smoke from chimney, icicles

#### Sound Effects
- Ambient wood-cutting sounds during construction
- Fire crackling (if nearby campfire)
- Wind through wooden walls
- Nighttime settling sounds (residents settling in)

### 6. Alpha 0x AI Integration

#### Villager AI Priorities
1. **Housing**: Homeless villagers (pop > housing) have lowest priority — game speed reduction if >20% homeless
2. **Work Assignment**: Assigned workers return to hut at day's end
3. **Rest**: Villagers sleep in hut at night (restoration of energy)
4. **Family**: Villagers with families prefer adjacent huts

#### Population AI
- **Marriage system**: Adult villagers seek mates when housing available
- **Birth cooldown**: First pregnancy requires 1 housing unit, subsequent births require +1 housing each
- **Generational turnover**: Elder villagers retire, huts can be reassigned to new families

#### RNG Seed Integration
- Hut placement seed affects **settlement density patterns**
- Clustering of huts creates neighborhoods — affects social dynamics
- Spread-out huts create rural communities — different resource access patterns

### 7. Alpha 0x Achievements & Milestones

#### Building Milestones
- **First Shelter**: Build first hut (early game achievement)
- **Permanent Settlement**: Population reaches 20 (3 huts built)
- **Stone Age Architect**: Evolve hut to stone house
- **Cottage Industry**: Build 5 cottages with food bonuses
- **High-Density Living**: Evolve to apartment with 20+ housing per unit

#### Population Milestones
- **Founding Family**: 10+ population with housing stability
- **Growing Community**: 25+ population with mixed housing types
- **Urban Center**: 50+ population with apartment complexes

### 8. Alpha 0x Modding Support

#### Extendable Properties
Modders can add:
- **New evolution paths** via `evolve` property
- **Custom housing bonuses** via `housing` property modifications
- **Seasonal adjustments** via `winter: true/false` property
- **Work bonuses** via `work` property (resource production while housed)

#### Example Mod Addition
```javascript
// Modder-added hut variant
hut_luxury: {
  name: 'Роскошная хижина',
  cost: { wood: 12, gold: 10 },
  housing: 10,
  special: 'wealth',
  req: 'aesthetics',
  desc: '+10 housing, +2 happiness, increases land value nearby'
}
```

#### Neighborhood System
```javascript
// Modder-created hut neighborhood bonus
neighborhood_bonus: {
  type: 'hut_cluster',
  effect: 'adjacent_huts_housing_multiplier',
  value: 1.2,  // 20% bonus to adjacent hut housing
  radius: 3
}
```

### Summary
The Alpha 0x **hut** is the **foundation of civilization** in Project Evolution. Its elegant simplicity — 6 wood, 4 housing, evolution paths — hides deep strategic choices that ripple through the entire game. The evolution system ensures it scales from first settlers to modern urban living, while maintaining relevance through all 10 epochs. The doubled design attention means every player choice — evolve to stone house, build cottages, or wait for apartments — meaningfully shapes their civilization's path from the ground up.

*Every civilization starts with shelter. Alpha 0x ensures the first building sets the tone for everything that follows.*