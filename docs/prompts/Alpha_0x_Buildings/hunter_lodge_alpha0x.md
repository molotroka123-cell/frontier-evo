# Alpha 0x Building: hunter_lodge

## Basic Info
- **ID**: hunter_lodge
- **Name**: Охотничья стоянка
- **Era**: Bronze Age (Era 1) — unlocks after `hunting` technology
- **Cost**: 10 wood
- **Workers**: 3 per hunting party
- **Daily Output**: +2.6 food per day (from hunting wildlife)
- **Special**: Organized wildlife hunting — provides food and occasionally resources
- **Requirement**: `hunting` technology must be researched
- **Evolves Into**: advanced hunting post, wildlife preserve

## Alpha 0x Logic Enhancements

### 1. Organized Hunting System
- **Hunting Parties**: 3 workers per expedition — each party returns daily with food
- **Base Yield**: 2.6 food per day — sufficient to feed 2-3 residents
- **Hunting Success Chance**: 66% base — 33% chance of "empty hunt" (no food, but no resource loss)
- **Wildlife Population**: Finite wildlife pool — over-hunting reduces future yields
- **Biome Variations**:
  - **Forest**: +20% food yield, normal wildlife population
  - **Tundra**: +10% food yield, fewer animals but harder to catch
  - **Grassland**: +30% food yield, abundant herds, migration patterns
  - **Mountain**: -20% food yield, difficult terrain, specialized mountain game

### 2. Evolution Path (Alpha 0x Upgrade System)
The hunter lodge can evolve into **3 different directions** based on technology and hunting philosophy:

#### Evolution A: Advanced Hunting Post (requires `iron` technology)
- **New Name**: Промышленная охотничья станция
- **Cost**: 20 wood + 15 stone (increased from 10 wood)
- **Workers**: 5 (increased from 3)
- **Daily Output**: +4.5 food per day (increased from 2.6)
- **Special**: Modern firearms and tracking technology — higher yield, but consumes ammunition
- **Visual**: Tower, storage racks, ammunition magazines, processing area
- **Unlock**: Available after iron tech (era 2)

#### Evolution B: Wildlife Preserve (conservation evolution, requires `mathematics`)
- **New Name**: Заповедник дикой природы
- **Cost**: 25 stone + 10 gold
- **Workers**: 2 (reduced from 3 — more management, less labor)
- **Daily Output**: +2.0 food per day (sustainable yield)
- **Special**: Catch-and-manage system — wildlife population regenerates, long-term food security
- **Visual**: Fenced wilderness area, ranger station, breeding enclosures, observation blinds
- **Unlock**: Available after mathematics tech (era 3)

#### Evolution C: Trapper's Network (requires `gunpowder` technology)
- **New Name**: Сетьловушки
- **Cost**: 30 wood + 10 gunpowder
- **Workers**: 3 (same)
- **Daily Output**: +2.8 food + 0.5 fur per day
- **Special**: Trapping system — provides food and fur resources for clothing trade
- **Visual**: Trap lines, fur storage, processing area, trade goods bundles
- **Unlock**: Available after gunpowder tech (era 4)

### 3. Alpha 0x Interactions

#### With Other Buildings
- **Hunter Lodge + Barracks**: Warrior training — hunted animals provide meat for soldier feasts, +5% soldier morale
- **Hunter Lodge + Farm**: Food synergy — farm workers gain +10% efficiency when hunting lodge active
- **Hunter Lodge + Market**: Resource surplus — excess food sold for gold, fur sold for +20% gold value
- **Hunter Lodge + Hospital**: Protein-rich diet — sick residents recover +15% faster with hunter-sourced food
- **Hunter Lodge + University**: Research subjects — animal behavior studies, +0.1 knowledge/day

#### With Technologies & Eras
- **Hunting tech prerequisite**: Hunter lodge cannot be built without `hunting` — ensures tech tree progression
- **Era scaling**: Food output scales gradually (2.6 → 4.5 → 4.0 sustainable → 2.8 + fur)
- **Ammunition system (iron evolution)**: Each hunt consumes 1 ammunition (gold cost) — infinite research unlocks infinite ammo

#### With Events
- **Boar hunt event**: Hunting party successfully takes down boar — +10 food immediate bonus
- **Wolf attack**: Hunting party confronts wolves — potential soldier experience gain or villager injury
- **Migration event**: Seasonal animal migration — 2× normal yield for 10 days
- **Trap failure**: Trapper network event — -50% yield for 5 days, trap repair needed

### 4. Gameplay Balance & Alpha 0x Tuning

#### Early Game Impact (Days 50-100, after hunting tech)
- **Food security**: 2.6 food/day — critical for population growth after initial farm establishment
- **Tech dependency**: Cannot build without hunting tech — ensures proper tech tree progression
- **Population support**: Each hunting lodge supports ~2.5 residents

#### Mid-Game Transition (Days 100-250)
- **Evolution decision**: Advanced post for maximum food, preserve for sustainability, trapper for resource diversity
- **Food race**: Players with advanced hunting posts gain population advantage
- **Resource competition**: Multiple hunting lodges in same biome reduce local wildlife

#### Late Game (Days 250+)
- **Advanced post relevance**: 4.5 food/day useful through industrial for supplemental food
- **Preserve relevance**: 2.0 sustainable food — valuable for long-term campaigns, eco-victories
- **Trapper relevance**: 2.8 food + fur — crafting-focused civilizations, trade economies
- **Obsolescence**: Original 2.6 food/day becomes supplemental; evolved versions provide specialized roles

### 5. Alpha 0x Visual & Audio

#### Evolution Visuals
- **Original hunter lodge**: Simple circle, fire pit, animal traps, hide storage, basic shelter
- **Advanced post**: Tower structure, weapon racks, processing tables, ammunition storage, modern appearance
- **Wildlife preserve**: Fenced wilderness, ranger station, breeding enclosures, observation blinds, conservation markers
- **Trapper's network**: Trap lines throughout area, fur piles, processing tables, trade goods neatly arranged

#### Seasonal Appearance
- **Spring**: Active hunting season, newborn animals visible, mating displays
- **Summer**: Peak hunting, abundant game, high activity
- **Autumn**: Pre-winter hunting, animals preparing, migration patterns
- **Winter**: Reduced activity, tracking in snow, survival-focused hunting

#### Sound Effects
- Gunshots/crossbow release (advanced post)
- Animal sounds and calls
- Trap snap mechanisms
- Skinning and processing sounds (trapper)
- Ranger patrol footsteps (preserve)

### 6. Alpha 0x AI Integration

#### Hunter AI Priorities
1. **Hunting expedition**: Primary task — lead hunting party within radius
2. **Resource processing**: Bring kill to storage, prepare meat for consumption
3. **Tool maintenance**: Repair weapons/traps after each hunt (wear chance per expedition)
4. **Rest**: Return to lodge at day's end if energy < 30%

#### Wildlife AI
- **Population tracking**: AI monitors local wildlife numbers — affects hunting success chance
- **Migration patterns**: Seasonal movement affects which biomes have wildlife available
- **Over-hunting consequences**: Repeated hunting in same area reduces population for 50+ days
- **Predator-prey balance**: Healthy ecosystem maintains balance — affects other predators (barracks, army)

#### RNG Seed Integration
- Hunter lodge seed determines **wildlife distribution** — affects map exploration and settlement placement
- Biome types create different economic specializations (grassland nations vs forest empires)
- Over-hunting patterns create long-term map resource depletion/evolution
- Migration patterns create dynamic resource availability across seasons

### 7. Alpha 0x Achievements & Milestones

#### Building Milestones
- **First Hunt**: Build hunter lodge and collect 10 food from hunting
- **Master Hunter**: Evolve to advanced hunting post
- **Conservationist**: Evolve to wildlife preserve
- **Trapper King**: Build trapper network and collect 50 fur
- **Cross-Era Hunter**: Maintain hunting lodge through all 10 epochs

#### Food Security Milestones
- **Well-Fed Population**: Population never experiences hunger for 100 days
- **Winter Preparedness**: Store 100 food from hunts before winter
- **Meat Surplus**: Accumulate 200 food from hunting surplus
- **Trade Revenue**: Generate 100 gold from selling hunting surplus

### 8. Alpha 0x Modding Support

#### Extendable Properties
Modders can add:
- **New evolution paths** via `evolve` property
- **Biome modifiers** via `biome` property [forest, tundra, grassland, mountain]
- **Ammunition consumption** via `ammo_consumption` property
- **Fur yield** via `fur_yield` property

#### Example Mod Addition
```javascript
// Modder-added hunter lodge variant
hunter_lodge_archery: {
  name: 'Лучница',
  cost: { wood: 12, stone: 8 },
  workers: 3,
  out: { food: 3.0 },
  biome: 'forest',
  special: 'archery',
  req: 'iron',
  desc: '+15% food yield in forests, hunters use bows (no ammo cost)'
}
```

#### Seasonal Migration System
```javascript
// Modder-created migration patterns
seasonal_migration: {
  name: 'Миграция стад',
  special: 'movement',
  effect: 'hunting_yield_multiplier',
  value: 2.0,  // Double yield during migration season
  months: [10, 11, 0, 1]  # Autumn, late autumn, winter, early winter
}
```

### Summary
The Alpha 0x **hunter lodge** provides **protein security** through organized wildlife hunting, evolving from simple hunting posts to sustainable preserves and industrial trapping networks. The evolution choices reflect different approaches to nature: exploitation (advanced post), conservation (preserve), or resource diversity (trapper). Each variant offers strategic flavor while maintaining core gameplay balance, ensuring hunter lodges remain relevant from bronze age first hunts through future era food security.

*From tracking footprints to industrial trapping — the evolution of food procurement through Alpha 0x optimization.*