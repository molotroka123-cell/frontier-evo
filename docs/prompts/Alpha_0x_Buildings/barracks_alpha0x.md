# Alpha 0x Building: barracks

## Basic Info
- **ID**: barracks
- **Name**: Казарма
- **Era**: Iron Age (Era 2) — unlocks after `warfare` technology
- **Cost**: 30 wood + 25 stone
- **Special**: Train recruits — produces military units (20 food + 10 gold per fighter trained)
- **Requirement**: `warfare` technology must be researched
- **Unique Feature**: `special: 'train'` — dedicated training functionality
- **Evolves Into**: training ground, war college, command center

## Alpha 0x Logic Enhancements

### 1. Military Training System
- **Training Capacity**: 1 unit per 20 food + 10 gold — each training cycle produces 1 soldier
- **Training Duration**: 3 days per unit — workers assigned during training period
- **Unit Quality**: Base power = 2 (militia) — improved through training upgrades and officer assignments
- **Recruit Pool**: Limited by available population — each trained unit reduces available population by 1
- **Training Bonuses**:
  - **Experienced trainers**: +10% training speed when adjacent to academy/university
  - **Morale bonus**: +5% combat power per consecutive training cycle completed
  - **Weapon upgrades**: +5% power per weapon technology researched (bronze → iron → steel)

### 2. Evolution Path (Alpha 0x Upgrade System)
The barracks can evolve into **3 different directions** based on military doctrine:

#### Evolution A: Training Ground (early military focus)
- **New Name**: Полигон
- **Cost**: 25 wood + 20 stone (reduced from barracks cost, specialized)
- **Workers**: 4 (increased from original training pool)
- **Daily Output**: +2 trained units per 3-day cycle (accelerated training)
- **Special**: Basic training facility — faster recruit production, foundational military skills
- **Visual**: Training field, drill instructors, weapon racks, obstacle course
- **Unlock**: Available after warfare tech (era 2) — alternative to original barracks

#### Evolution B: War College (strategic military focus, requires `military_education` - hypothetical)
- **New Name**: Военная коллегия
- **Cost**: 100 stone + 80 gold + 30 steel (future tech path)
- **Workers**: 5
- **Daily Output**: +1 high-quality unit per 5-day cycle + +0.5 knowledge per day (strategic studies)
- **Special**: Officer training — produces elite units with +50% power, strategic doctrine research
- **Visual**: Academic building, war maps, strategy tables, officer portraits, lecture halls
- **Unlock**: Requires military education tech (hypothetical future tech branch)

#### Evolution C: Command Center (modern military focus, requires `electricity`)
- **New Name**: Командный центр
- **Cost**: 150 steel + 100 gold + 50 stone (modern era)
- **Workers**: 3
- **Daily Output**: +1 elite unit per 2-day cycle + +2.0 knowledge per day (digital warfare)
- **Special**: Networked command — drone coordination, satellite intelligence, automated defense systems
- **Visual**: Glass-walled command center, holographic maps, drone control consoles, communication arrays
- **Unlock**: Available after electricity tech (era 7)

### 3. Alpha 0x Interactions

#### With Other Buildings
- **Barracks + Training Ground (evolved)**: Direct lineage — training ground receives +20% production speed bonus from barracks heritage
- **Barracks + University**: Officer education — trained units gain +10% power when university adjacent
- **Barracks + Academy**: Strategic studies — +0.1 knowledge/day from military research
- **Barracks + Hospital**: Wounded care — injured soldiers recover +30% faster when treated at nearby hospital
- **Barracks + Market**: Equipment funding — market gold surplus can fund barracks upgrades (-20% cost for 50 gold)

#### With Units & Army System
- **Unit production**: Barracks produces militia (power 2) → can upgrade to swordsman (power 4) → knight (power 7) → musketeer (power 10) etc.
- **Upkeep cost**: ARMY_UPKEEP = {food: 0.5, gold: 0.2} per soldier per day — barracks manages payment
- **Combat attrition**: Damaged units return to barracks for repair — 50% repair cost in food/gold
- **Experience gain**: Units gain +1 experience per battle won, veteran units have +10% power

#### With Events
- **Raid event**: Enemy army attacks — barracks units defend, potential building damage if defense fails
- **Volunteer recruitment**: Population surplus — +2 units trained instantly if population > housing
- **Military parade**: Happiness event — +3 happiness for 5 days if barracks present with trained units
- **Conscription**: Population pressure — -10% happiness, +3 units trained instantly

### 4. Gameplay Balance & Alpha 0x Tuning

#### Early Game Impact (Days 100-200, after warfare tech)
- **Military capability**: First trained units — defense against raids, offense capability
- **Resource sink**: 30 wood + 25 stone significant early game cost
- **Population trade-off**: Each trained unit reduces population by 1 — strategic decision

#### Mid-Game Transition (Days 200-400)
- **Evolution decision**: Training ground for rapid expansion, war college for elite units, command center for modern warfare
- **Army growth**: Players build armies from militia to elite units — military strategy development
- **Tech integration**: Warfare tech branch affects unit quality and capabilities

#### Late Game (Days 400+)
- **Training ground relevance**: 2 units/3-day cycle — useful through medieval for rapid army expansion
- **War college**: Elite units with +50% power — valuable for specialized military campaigns
- **Command center**: Drone coordination, modern warfare — essential for future era military
- **Obsolescence**: Original barracks unit production becomes basic; evolved versions provide specialized military roles

### 5. Alpha 0x Visual & Audio

#### Evolution Visuals
- **Original barracks**: enclosed area, weapon racks, training dummies, basic shelter for trainees
- **Training ground**: open field, drill instructors, obstacle course, weapon racks, visible training activity
- **War college**: academic building, war maps, strategy tables, officer regalia, intellectual atmosphere
- **Command center**: modern glass structure, holographic maps, drone consoles, communication arrays, sleek design

#### Seasonal Appearance
- **Spring**: Training season — new recruits, fresh equipment, outdoor drills
- **Summer**: Peak training, field exercises, combat readiness
- **Autumn**: Preparation for winter — indoor training, maintenance cycles
- **Winter**: Indoor training, maintenance, equipment storage

#### Sound Effects
- Drill commands and marching boots
- Weapon clanking and training sounds
- Strategy discussion and map marking (war college)
- Holographic interface sounds (command center)
- Radio communication (command center)

### 6. Alpha 0x AI Integration

#### Trainer AI Priorities
1. **Recruit training**: Primary task — train new units from available population
2. **Unit quality**: Improve trained unit power through upgrades and bonuses
3. **Equipment management**: Assign weapons/gear to trained units
4. **Rest**: Return to barracks at day's end if energy < 30%

#### Army AI
- **Unit production queue**: AI manages trained units queue based on military needs
- **Experience tracking**: Units gain experience from battles, level up with power bonuses
- **Upkeep management**: AI ensures food/gold upkeep paid each day, reduces resources accordingly
- **Combat assignment**: Units assigned to defend city, attack enemies, or patrol based on threat level

#### RNG Seed Integration
- Barracks seed determines **military tradition** — affects unit types and capabilities
- Different seed values produce different "military doctrines" (defensive, offensive, balanced)
- Training patterns create different army compositions over time
- Experience gain patterns create veteran units with unique characteristics

### 7. Alpha 0x Achievements & Milestones

#### Building Milestones
- **First Unit**: Train first soldier (militia, power 2)
- **Drill Instructor**: Evolve to training ground
- **War College Dean**: Evolve to war college
- **Commander-in-Chief**: Evolve to command center
- **Army Builder**: Train 50+ units total

#### Military Milestones
- **First Victory**: Win first battle with trained units
- **Veteran Army**: 10+ experienced units with +10% power bonus
- **Elite Force**: 5+ elite units with +50% power from war college
- **Modern Army**: 20+ units with drone/command center support

### 8. Alpha 0x Modding Support

#### Extendable Properties
Modders can add:
- **New evolution paths** via `evolve` property
- **Unit quality modifiers** via `unit_power` property
- **Training speed** via `training_days` property
- **Experience gain rates** via `exp_gain` property

#### Example Mod Addition
```javascript
// Modder-added barracks variant
barracks_elite: {
  name: 'Элитная казарма',
  cost: { wood: 40, stone: 35, gold: 20 },
  workers: 5,
  special: 'train',
  req: 'iron',
  desc: 'Faster training (2-day cycles), elite units +30% power, higher cost'
}
```

#### Military Doctrine System
```javascript
// Modder-created military doctrine
military_doctrine: {
  name: 'Оборонная доктрина',
  special: 'unit_type',
  effect: 'unit_power_modifier',
  value: 1.2,  // 20% stronger all units
  req: 'warfare'
}
```

### Summary
The Alpha 0x **barracks** transforms population into military capability, evolving from basic training grounds to modern command centers with drone coordination. The evolution path reflects humanity's military development: basic recruitment → officer training → digital networked warfare. Each variant offers strategic flavor: the rapid expansion trainer (training ground), the elite producer (war college), or the modern warlord (command center) — allowing players to shape their civilization's military doctrine and army composition.

*From recruitment to networked command — the evolution of military power through Alpha 0x optimization.*