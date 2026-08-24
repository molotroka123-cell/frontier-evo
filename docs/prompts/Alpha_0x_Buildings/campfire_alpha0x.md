# Alpha 0x Building: campfire

## Basic Info
- **ID**: campfire
- **Name**: Кострище
- **Era**: Stone Age (Era 0)
- **Cost**: Free (no resources required)
- **Housing**: 6 residents
- **Workers**: 2 (default hearthkeepers)
- **Daily Output**: +0.3 knowledge per day
- **Special**: Heart of the settlement — provides social gathering bonus

## Alpha 0x Logic Enhancements

### 1. Settlement Heart Mechanics
- The campfire is the **obligatory starting building** — every new game begins with 1 campfire automatically placed at the settlement center
- Provides **social radius** of 5 tiles — residents within range gain +10% happiness when near the fire
- Daily "story time" event: 33% chance to generate an **insight event** (knowledge +15, happiness +2) if a great person is present

### 2. Evolution Path (Alpha 0x Upgrade System)
The campfire can evolve into **3 different directions** based on player choice and era progression:

#### Evolution A: Story Fire (requires `language` technology)
- **New Name**: Костёр историй
- **Output**: +0.5 knowledge/day (increased from 0.3)
- **Workers**: 2 (same)
- **Special**: Unlocks `insight` event pool, +25% knowledge generation from all sources
- **Visual**: Stone ring around the fire, decorative bones/charms

#### Evolution B: Community Fire (requires 15 population)
- **New Name**: Общественный костер
- **Output**: +0.4 knowledge/day, +2 happiness/day
- **Special**: Larger social radius (8 tiles), attracts wandering traders
- **Visual**: Elevated fire pit with seating area

#### Evolution C: Sacred Fire (requires `theology` technology)
- **New Name**: Священный огонь
- **Output**: +0.3 knowledge/day, +5 happiness/day, **plague immunity** for nearby residents
- **Special**: Reduces disease spread, holy buff during combat
- **Visual**: Blue-tinted flames, sacred geometry pattern

### 3. Alpha 0x Interactions

#### With Other Buildings
- **Story Fire (evolved)**: Provides +0.1 knowledge/day bonus to nearby **academies** and **universities**
- **Campfire + Hunter's Lodge**: Shared warmth bonus — hunters return with +10% more food
- **Campfire + Barracks**: Veterans gather around the fire — trained soldiers gain +5% experience

#### With Events
- **Berry Year event**: Campfire amplifies effect — food bonus increased by 20%
- **First Frost event**: Campfire provides passive heat — reduces food penalty by 50%
- **Wolf event**: Campfire acts as deterrent — 50% chance wolves bypass settlements with active campfire

### 4. Gameplay Balance & Alpha 0x Tuning

#### Early Game Impact
- **Knowledge generation**: 0.3/day → accelerates tech research by ~15% in first 50 days
- **Housing**: 6 residents — supports small population of 6-8 villagers early game
- **No resource cost** — ensures every start has a functional foundation

#### Mid-Game Transition
- As population grows, campfire becomes **bottleneck** — players must evolve or build additional housing
- Evolution choice shapes early game direction:
  - **Story Fire** → knowledge-focused civilizations
  - **Community Fire** → balanced growth with trader attraction
  - **Sacred Fire** → survival-focused, disease-resistant empires

#### Late Game
- Campfire still provides **base knowledge** (0.3/day) even at future epochs
- Can be replaced by **larger knowledge buildings** but retains unique social mechanics
- **Sacred Fire** evolution provides crucial disease immunity in plague-heavy campaigns

### 5. Alpha 0x Visual & Audio

#### Day/Night Cycle
- **Night**: Fire glows brighter, visible from greater distance
- **Rain**: Fire smoke particles, reduced efficiency (-10% knowledge)
- **Snow**: Fire provides heat radius — residents gain +1 happiness when nearby

#### Sound Effects
- Ambient crackling fire sound (volume adjustable)
- Nighttime "storytelling" voice lines from great people
- Weather-specific sound variations (wind through flames, rain on coals)

### 6. Alpha 0x AI Integration

#### Villager AI Priorities
1. **Warmth**: Villagers prioritize sleeping/eating near campfire in cold seasons
2. **Social**: Residents visit campfire for happiness boost when boredom > 50
3. **Work**: New villagers born at campfire (if housing available)
4. **Defense**: Villagers gather at campfire during night attacks

#### RNG Seed Integration
- Campfire seed determines **settlement layout patterns** — affects where other buildings can be placed
- Different seed values produce different "personalities" for the settlement's early development

### 7. Alpha 0x Achievements & Milestones

#### Building Milestones
- **First Fire**: Start a new game (trivial achievement)
- **Storyteller**: Evolve campfire to Story Fire (unlocks knowledge events)
- **Healer's Hearth**: Evolve to Sacred Fire during first plague event
- **Community Center**: Have 5+ residents regularly visiting campfire

#### Era-Transcendent
- Campfire remains functional and provides unique bonuses throughout all 10 epochs
- Evolved versions scale with era (knowledge output increases gradually)
- Visual redesign per era while maintaining core function

### 8. Alpha 0x Modding Support

#### Extendable Properties
Modders can add:
- **New evolution paths** via `evolve` property
- **Custom aura effects** via `aura` property
- **Seasonal bonuses** via `season` property
- **Event condiitions** via `cond` property

#### Example Mod Addition
```javascript
// Modder-added campfire variant
campfire_night: {
  name: 'Ночной костер',
  cost: {},
  housing: 6,
  out: { knowledge: 0.5 },
  special: 'night_boost',
  req: 'electricity',  // Modern era requirement
  desc: 'Glowing night fire, knowledge +0.5, visible from 10 tiles'
}
```

### Summary
The Alpha 0x **campfire** is more than just a building — it's the **spiritual and mechanical heart** of every settlement. Its evolution choices shape the entire early game direction, its interactions with other buildings create emergent gameplay, and its presence throughout all 10 epochs ensures it remains relevant from first fire to interstellar civilization. The doubled attention to this fundamental building sets the tone for the entire Alpha 0x building system: **every structure matters, every choice has consequences, and everything scales beautifully through time.**