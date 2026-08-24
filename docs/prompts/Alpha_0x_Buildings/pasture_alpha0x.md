# Alpha 0x Building: pasture

## Basic Info
- **ID**: pasture
- **Name**: Пастбище
- **Era**: Bronze Age (Era 2) — unlocks after `animal_husbandry` technology
- **Cost**: 14 wood
- **Workers**: 3 per shift
- **Daily Output**: +2.4 food per day (from livestock grazing)
- **Special**: Seasonal grazing — animals provide food year-round with winter bonus
- **Requirement**: `animal_husbandry` technology must be researched
- **Special Trait**: `winter: true` — works during winter (unlike farms)
- **Tile Requirement**: Must be placed on TILE.GRASS tile
- **Evolves Into**: intensive pasture, automated feedlot

## Alpha 0x Logic Enhancements

### 1. Grazing System with Seasonal Cycle
- **Grazing Radius**: 4-tile radius from building, must be on grass tile
- **Daily Yield**: 2.4 food per 3 workers — sufficient to feed 2-3 residents
- **Winter Bonus**: +50% food output (3.6 food) — "animals remain productive, snow-free grazing"
- **Seasonal Modifiers**:
  - **Spring**: +20% food (3.88) — fresh grass, animals after winter birthing
  - **Summer**: +10% food (2.64) — lush grass peak growth
  - **Autumn**: Normal (2.4) — preparation for winter, harvest grazing
  - **Winter**: +50% food (3.6) — snow-free grazing, animal warmth maintenance
- **Stock Management**: 
  - Maximum animal capacity per pasture: 15 "units"
  - Overstocking ( >15 units) reduces yield by 20% per excess unit
  - Understocking (<10 units) reduces yield by 10% — "not enough animals maintaining grass"

### 2. Evolution Path (Alpha 0x Upgrade System)
The pasture can evolve into **3 different directions** based on technology and livestock management:

#### Evolution A: Intensive Pasture (requires `machinery` technology)
- **New Name**: Интенсивное пастбище
- **Cost**: 20 wood + 10 machinery (increased from 14 wood)
- **Workers**: 4 (increased from 3)
- **Daily Output**: +4.0 food per day (increased from 2.4, base; +6.0 with winter)
- **Special**: Fenced rotating grazing sections, managed livestock, 2× stocking capacity
- **Visual**: Double fencing, automated gates, livestock counting system, processing area
- **Unlock**: Available after machinery tech (era 5)

#### Evolution B: Automated Feedlot (requires `robotics` technology)
- **New Name**: Автоматизированный кормовый двор
- **Cost**: 100 steel + 50 gold + 30 stone (future tech)
- **Workers**: 0 (automated)
- **Daily Output**: +6.0 food per day (2.5× original, year-round with winter bonus)
- **Special**: Robotic feeding system — livestock fed optimized rations, 24/7 operation, zero labor
- **Visual**: Automated feed dispensers, climate-controlled barns, robotic herders, data monitors
- **Unlock**: Available after robotics + AI era (era 9-10)

#### Evolution C: Dairy & Wool Cooperative (requires `philosophy` technology)
- **New Name**: Даир-овольни cooperative
- **Cost**: 25 wood + 15 gold + 8 stone
- **Workers**: 3 (same)
- **Daily Output**: +2.4 food + 0.5 milk + 0.3 wool per day
- **Special**: Multi-output livestock — not just meat, but dairy and wool resources for clothing and trade
- **Visual**: Milking stations, wool processing, cheese-making area, storage for dairy products
- **Unlock**: Available after philosophy tech (era 3)

### 3. Alpha 0x Interactions

#### With Other Buildings
- **Pasture + Farm**: Complementary food — farms summer, pastures winter, combined food security year-round
- **Pasture + Hospital**: Nutritious diet — recovering patients gain +20% faster recovery with pasture-sourced food
- **Pasture + Market**: Livestock surplus — excess food and resources sold for gold; wool +15% gold value
- **Pasture + University**: Agricultural research — students study livestock management, +0.1 knowledge/day
- **Pasture + Barracks**: Protein for soldiers — well-fed troops gain +5% combat effectiveness

#### With Technologies & Eras
- **Animal husbandry prerequisite**: Pasture cannot be built without `animal_husbandry` — ensures tech tree progression
- **Winter survival**: Unique among food buildings — pasture works during winter while farms stop
- **Era scaling**: Food output scales (2.4 → 4.0 → 6.0 automated → 2.4 + dairy/wool)

#### With Events
- **Lambing season event**: +30% food yield for 15 days — "animals birthing, abundant milk"
- **Disease outbreak**: Reduces livestock health — 20% yield reduction for 10 days, requires hospital
- **Blizzard**: Winter storm — if pasture not winter-capable, -50% yield; winter-capable pastures maintain full output
- **Overgrazing**: Player-caused event — if too many pastures, grass depleted, -30% yield for 30 days

### 4. Gameplay Balance & Alpha 0x Tuning

#### Early Game Impact (Days 100-150, after animal husbandry tech)
- **Winter food security**: Unique capability — pasture provides food when farms fail
- **Population support**: Each pasture supports ~2.5 residents + winter resilience
- **Tech dependency**: Cannot build without animal husbandry — ensures proper progression

#### Mid-Game Transition (Days 150-300)
- **Evolution decision**: Intensive pasture for maximum food, automated for post-scarcity, dairy for diversity
- **Seasonal strategy**: Players manage pasture output across seasons — winter advantage vs summer optimization
- **Land use competition**: Pastures require grass tiles — competes with farms, lumber (forests)

#### Late Game (Days 300+)
- **Intensive pasture relevance**: 4.0 food/day useful through industrial for supplemental food
- **Automated feedlot**: 6.0 food/day — post-scarcity food production, eliminates food concerns
- **Dairy cooperative**: 2.4 food + dairy/wool — crafting-focused, trade economy civilizations
- **Obsolescence**: Original 2.4 food/day becomes specialized; evolved versions provide primary food source

### 5. Alpha 0x Visual & Audio

#### Evolution Visuals
- **Original pasture**: Open grass area, herds of animals grazing, simple shepherd shelter
- **Intensive pasture**: Double-fenced rotating sections, livestock counting, automated gates, modern shepherd hut
- **Automated feedlot**: Climate-controlled barns, robotic feed dispensers, herds in enclosed areas, data monitors
- **Dairy cooperative**: Milking stations, cheese-making area, wool processing, product storage, cooperative building

#### Seasonal Appearance
- **Spring**: New grass growth, newborn animals, shepherds with baby animals
- **Summer**: Lush green grass, animals resting in shade, peak grazing
- **Autumn**: Golden grass, harvest preparation, animals gaining weight for winter
- **Winter**: Snow-free grazing area (intensive/automated), animals huddled for warmth, steam from breath

#### Sound Effects
- Animal grazing sounds (grass rustling)
- Herder calls and whistles
- Milking station sounds (dairy cooperative)
- Robot mechanical sounds (automated feedlot)
- Fence gate operations (intensive pasture)

### 6. Alpha 0x AI Integration

#### Herder AI Priorities
1. **Grazing management**: Primary task — manage livestock within radius
2. **Stock counting**: Monitor animal numbers, adjust grazing rotation
3. **Winter preparation**: Seasonal adjustments before winter begins
4. **Rest**: Return to shelter at day's end if energy < 30%

#### Livestock AI
- **Herd behavior**: AI simulates animal herd dynamics — movement, grazing patterns
- **Stock limit enforcement**: AI prevents overstocking/yield reduction
- **Seasonal migration**: Animals move based on season and grass availability
- **Breeding cycle**: Random chance each season to increase animal count (up to capacity)

#### RNG Seed Integration
- Pasture seed determines **grassland distribution** — affects map settlement patterns
- Grass tile scarcity vs abundance creates different settlement densities
- Over-grazing patterns create long-term map degradation/recovery
- Seasonal patterns create predictable resource cycles players can plan around

### 7. Alpha 0x Achievements & Milestones

#### Building Milestones
- **First Grazing**: Build pasture and collect 10 food
- **Winter Warrior**: Maintain pasture through first winter with full output
- **Intensive Manager**: Evolve to intensive pasture
- **Automation King**: Evolve to automated feedlot (0 workers)
- **Dairy Entrepreneur**: Evolve to dairy cooperative and collect 50 milk

#### Food Security Milestones
- **Winter Survival**: Survive first winter with full food from pasture
- **Year-Round Feeding**: Maintain population food stability across all 4 seasons
- **Food Surplus**: Accumulate 200 food from pasture outputs
- **Resource Diversity**: Collect 100 milk + 100 wool from dairy cooperative

### 8. Alpha 0x Modding Support

#### Extendable Properties
Modders can add:
- **New evolution paths** via `evolve` property
- **Seasonal modifiers** via `season` property with multiplier values
- **Stock capacity** via `max_animals` property
- **Multi-output resources** via `secondary_outputs` property (milk, wool, etc.)

#### Example Mod Addition
```javascript
// Modder-added pasture variant
pasture_alpine: {
  name: 'Альпийское пастбище',
  cost: { wood: 18, stone: 10 },
  workers: 4,
  out: { food: 3.0 },
  biome: 'mountain',
  special: 'high_altitude',
  req: 'animal_husbandry',
  desc: 'Yield reduced 20%, but works at any elevation, animals are sure-footed'
}
```

#### Multi-Output Livestock System
```javascript
// Modder-created secondary resources
livestock_multi_output: {
  name: 'Многоплодный скот',
  special: 'secondary_resources',
  effect: 'additional_outputs',
  value: { milk: 0.8, wool: 0.5 },  // per day alongside food
  req: 'philosophy'
}
```

### Summary
The Alpha 0x **pasture** solves the critical problem of **winter food security** — the only major food building that works during winter while farms lie dormant. From simple grazing to automated feedlots and dairy cooperatives, the evolution path reflects humanity's advancing mastery over livestock management. Each variant offers strategic flavor: the intensive producer, the post-scarcity automation, or the diversified dairy-wool cooperative — allowing players to shape their civilization's agricultural strategy around seasonal challenges.

*From winter survival to post-scarcity farming — the pasture's evolution through Alpha 0x ensures food year-round, no matter the season.*