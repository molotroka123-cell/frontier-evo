# Alpha 0x Building: forager

## Basic Info
- **ID**: forager
- **Name**: Собиратели
- **Era**: Stone Age (Era 0)
- **Cost**: 8 wood
- **Workers**: 2 per gathering team
- **Daily Output**: +2.2 food per team per day
- **Special**: Early-game food gathering from wild plants, berries, and mushrooms
- **Tile Requirement**: Any walkable tile (grass, sand, forest, hill)

## Alpha 0x Logic Enhancements

### 1. Wild Food Gathering System
- **Foraging Radius**: 5-tile radius around the building
- **Daily Yield**: 2.2 food per 2 workers — sufficient to feed 2-3 residents
- **Seasonal Modifiers**:
  - **Spring**: +30% food (abundant new growth)
  - **Summer**: +15% food (peak berry season)
  - **Autumn**: +20% food (mushrooms and nuts)
  - **Winter**: -40% food (scarcity, snow cover)
- **Random Events**: Each season has 25% chance of special forage event (rich patch, rare mushroom, honeycomb)

### 2. Evolution Path (Alpha 0x Upgrade System)
The forager can evolve into **4 different directions** based on technology and era:

#### Evolution A: Berry Farm (requires `farming` technology)
- **New Name**: Ягодное поле
- **Cost**: 12 wood (increased from 8)
- **Workers**: 3 (increased from 2)
- **Daily Output**: +4.0 food per day (increased from 2.2)
- **Special**: Cultivated berries — 3× natural yield, permanent source
- **Visual**: Structured berry bushes, irrigation ditches, fence protection
- **Unlock**: Available after farming tech (era 0→1 transition)

#### Evolution B: Hunter-Gatherer Camp (requires `hunting` technology)
- **New Name**: Смешанная станция
- **Cost**: 10 wood
- **Workers**: 3 (increased from 2)
- **Daily Output**: +2.6 food + 1.5 bonus chance for "hunt success" event
- **Special**: Combines foraging with occasional hunting — meat may supplement food
- **Visual**: Tents among foraging pits, cooking fire, animal traps
- **Unlock**: Available after hunting tech

#### Evolution C: Gathering Station (requires `pottery` technology)
- **New Name**: Станция собирателей
- **Cost**: 15 wood + 8 stone (pottery unlocked)
- **Workers**: 3
- **Daily Output**: +3.5 food, **+0.3 knowledge** (record-keeping of harvests)
- **Special**: Storage pits prevent seasonal loss — food preserved for winter
- **Visual**: Earthenware jars, storage pits, covered work areas
- **Unlock**: Available after pottery tech (bronze era)

#### Evolution D: Vertical Farm (requires `electricity` technology)
- **New Name**: Вертикальная ферма
- **Cost**: 50 stone + 30 steel + 20 gold (modern tech)
- **Workers**: 4
- **Daily Output**: +8.0 food (4× original, year-round production)
- **Special**: Indoor hydroponics/ais farming — completely weatherproof, 365 days/year
- **Visual**: Tiered growing racks, LED grow lights (modern), automated systems (future)
- **Unlock**: Available after electricity + genetics era (era 8-9)

### 3. Alpha 0x Interactions

#### With Other Buildings
- **Forager + Farm**: Adjacent farms gain +10% food yield — foragers train farmers in wild techniques
- **Forager + Story Fire (evolved campfire)**: Shared knowledge — +0.1 knowledge/day from foraging wisdom
- **Forager + Granary**: Connected granary stores excess — prevents food spoilage, cap increased by 150
- **Forager + Hospital**: Well-fed residents — 50% faster recovery from illness
- **Forager + Bank**: Surplus food stored — bank accepts food as collateral for gold loans

#### With Seasons & Weather
- **Harvest Event**: Autumn has 20% chance of " bumper crop" — +10 food instead of normal yield
- **Drought**: Summer reduces yield by 30% — wells and water buildings compensate
- **First Frost**: Winter penalty applies — foragers reduce activity, residents rely on stored food
- **Abundant Year**: Random event — +50% food for 10 days, celebration happiness +5

#### With Events
- **Berry Year event**: Foraging yield ×2 for 15 days — "Forest is incredibly productive this year"
- **Lost Child**: Missing child found near foraging pit — 100% success rate if within 3 tiles
- **Stranger Sick**: Foraging team member ill — temporary loss of 1 worker for 5 days
- **First Frost**: Activity reduces by 40% — food output halved until spring

### 4. Gameplay Balance & Alpha 0x Tuning

#### Early Game Impact (Days 1-50)
- **Food security**: 2.2 food/day per team — feeds 2-3 residents comfortably
- **Wood cost**: 8 wood — early game resource management, compete with hut (6 wood) and lumber (10 wood)
- **Population cap interaction**: Each forager team supports ~2.5 residents before food shortage

#### Mid-Game Transition (Days 50-150)
- **Tech unlock decision**: Farming vs hunting vs pottery — each offers different food security path
- **Evolution timing**: Berry farm for steady production, gathering station for knowledge+safety, hunter camp for variety
- **Population growth**: Food availability directly limits population growth rate

#### Late Game (Days 150+)
- **Forager obsolescence**: Original 2.2 food/day becomes insufficient
- **Evolved versions remain viable**:
  - **Berry farm** (4.0 food) — useful through classical era with management
  - **Gathering station** (3.5 food + knowledge) — knowledge-focused empires
  - **Hunter camp** (2.6 food + variety) — military/survival-focused
  - **Vertical farm** (8.0 food) — modern era high-density food production
- **Strategic layer**: Players may maintain evolved foragers for specialty foods, wilderness maps, or emergency food security

### 5. Alpha 0x Visual & Audio

#### Evolution Visuals
- **Original forager**: Simple pit with baskets, foraging tools, scattered plants
- **Berry farm**: Structured rows, irrigation, protective fencing, signage
- **Hunter-gatherer camp**: Tents, animal hides, cooking fire, traps visible
- **Gathering station**: Earthenware storage jars, covered pits, record tablets
- **Vertical farm**: Tiered indoor racks, automated systems, climate control

#### Seasonal Appearance
- **Spring**: New growth, flowers, fresh plant indicators
- **Summer**: Full berries, ripe plants, abundant appearance
- **Autumn**: Harvest colors, gathered crops, storage pits full
- **Winter**: Snow cover, reduced activity, icicles, stored food visible

#### Sound Effects
- Bird calls and wind through plants
- Basket/rustling sounds when workers active
- Cooking fire crackle (nearby)
- Clay jar placement sounds (gathering station)
- Mechanical hum (vertical farm)

### 6. Alpha 0x AI Integration

#### Worker AI Priorities
1. **Food gathering**: Primary task — collect food within radius
2. **Storage**: Deposit collected food to granary or storage building
3. **Rest**: Return to rest at day's end if energy < 30%
4. **Tool maintenance**: Repair foraging tools when worn (10% chance per season)

#### Population AI
- **Hunting gathering**: Families with hunting tech send adults to hunter camps
- **Plant knowledge**: Children learn plant identification from elders at gathering stations
- **Seasonal migration**: AI adjusts foraging patterns based on season forecasts

#### RNG Seed Integration
- Forager seed determines **wilderness distribution** — affects map exploration patterns
- Different seed values produce different "food abundance" regions
- Clustering of foragers creates concentrated food sources — trade opportunities
- Spread-out foragers create dispersed settlement patterns

### 7. Alpha 0x Achievements & Milestones

#### Building Milestones
- **First Harvest**: Build first forager and collect 10 food
- **Berry Specialist**: Evolve to berry farm
- **Knowledge Keeper**: Evolve to gathering station (knowledge output)
- **Hunting Party**: Evolve to hunter-gatherer camp
- **Food Surplus**: Store 100 food in granary

#### Food Security Milestones
- **Well-Fed**: Population never experiences food shortage for 50 days
- **Bountiful Year**: Survive drought event with full food reserves
- **Winter Preparedness**: Have 50+ food stored before winter begins

### 8. Alpha 0x Modding Support

#### Extendable Properties
Modders can add:
- **New evolution paths** via `evolve` property
- **Seasonal modifiers** via `season` property with values [spring, summer, autumn, winter]
- **Yield bonuses** via `boost` property (e.g., `boost: 'story_fire'`)
- **Event conditions** via `cond` property

#### Example Mod Addition
```javascript
// Modder-added forager variant
forager_medicinal: {
  name: 'Лечебная станция',
  cost: { wood: 10 },
  workers: 2,
  out: { food: 2.0, knowledge: 0.3 },
  special: 'medicinal',
  req: 'medicine',
  desc: 'Gathers healing plants +0.3 knowledge, food +2.0, requires medicine tech'
}
```

#### Sacred Plant System
```javascript
// Modder-created sacred foraging area
sacred_grove: {
  name: 'Священный рощ',
  cost: { wood: 20, stone: 10 },
  special: 'spirit',
  req: 'theology',
  effect: 'adjacent_buildings_happy_multiplier',
  value: 1.1,  // 10% happiness boost to nearby buildings
  radius: 5
}
```

### Summary
The Alpha 0x **forager** establishes the **food foundation** of every civilization. From humble gathering of wild plants to advanced vertical farms, the evolution choices shape economic strategy, technological path, and population sustainability. The modular design ensures relevance from the first hungry settlers through interstellar civilization, with each variant offering distinct strategic flavor while maintaining core gameplay balance.

*From wild berries to controlled agriculture — the forager's evolution mirrors civilization's journey from survival to abundance.*