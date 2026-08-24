# Alpha 0x Building: story_fire

## Basic Info
- **ID**: story_fire
- **Name**: Костёр историй
- **Era**: Stone Age (Era 0) — unlocks after `language` technology
- **Cost**: 10 wood
- **Workers**: 2 per shift
- **Daily Output**: +0.5 knowledge per day
- **Special**: Oral tradition — preserves and transmits knowledge through storytelling
- **Requirement**: `language` technology must be researched
- **Evolves Into**: academy (via knowledge path), story circle (cultural path)

## Alpha 0x Logic Enhancements

### 1. Oral Knowledge System
- **Knowledge Generation**: 0.5 knowledge per day — equivalent to ~15% of early tech research rate
- **Story Radius**: 4-tile radius — residents within range gain knowledge bonus
- **Great Person Integration**: When a great person (scientist, philosopher) is present, knowledge output ×2 (1.0 knowledge/day)
- **Intergenerational Learning**: Each generation of villagers visiting the story fire contributes — cumulative knowledge gain over time
- **Seasonal Modifiers**:
  - **Spring**: +20% knowledge (renewal, new stories)
  - **Summer**: +10% knowledge (active storytelling season)
  - **Autumn**: +15% knowledge (harvest stories, preparations for winter)
  - **Winter**: -10% knowledge (indoor hibernation, less storytelling)

### 2. Evolution Path (Alpha 0x Upgrade System)
The story fire can evolve into **3 different directions** based on technology and cultural focus:

#### Evolution A: Academy (requires `mathematics` technology)
- **New Name**: Академия
- **Cost**: 70 stone + 30 gold (increased from story fire cost)
- **Workers**: 4 (increased from 2)
- **Daily Output**: +2.2 knowledge per day (increased from 0.5)
- **Special**: Institution of higher learning — structured curriculum, research projects, student housing
- **Visual**: Columns, library tablets, lecture hall, student quarters, academic regalia
- **Unlock**: Available after mathematics tech (era 3)

#### Evolution B: Story Circle (cultural evolution, no tech req but needs high housing)
- **New Name**: Толковый круг
- **Cost**: 8 wood + 5 happiness (maintenance)
- **Workers**: 3 (increased from 2)
- **Daily Output**: +0.8 knowledge + +3 happiness per day
- **Special**: Community storytelling — preserves history, transmits cultural values, +3 happiness from shared heritage
- **Visual**: Circle of stones, painted drums, gathering area, decorative symbols
- **Unlock**: Available when population reaches 20+ and happiness > 10

#### Evolution C: Digital Archive (requires `internet` technology)
- **New Name**: Цифровой архив
- **Cost**: 150 stone + 100 gold + 50 steel (future tech)
- **Workers**: 3
- **Daily Output**: +5.0 knowledge per day (10× original)
- **Special**: Server-based knowledge storage — all civilization knowledge preserved, searchable, backup systems
- **Visual**: Server racks, holographic displays, data terminals, glass-walled reading room
- **Unlock**: Available after internet tech (era 8)

### 3. Alpha 0x Interactions

#### With Other Buildings
- **Story Fire + Academy (evolved)**: Direct lineage — academy receives +20% knowledge bonus from story fire heritage
- **Story Fire + University**: Synergistic knowledge — combined output +25% vs individual
- **Story Fire + Hospital**: Healing narratives — sick residents visiting story fire recover +20% faster
- **Story Fire + Barracks**: Morale storytelling — soldiers gain +5% experience when hearing tales before battle
- **Story Fire + Bank**: Financial wisdom — knowledge of economic history, +0.1 gold/day from better decisions

#### With Technologies & Eras
- **Language tech prerequisite**: Story fire cannot be built without `language` — ensures tech tree progression
- **Era scaling**: Knowledge output scales gradually across eras (0.5 → 1.0 → 2.2 → 3.5 → 5.0)
- **Great person amplification**: Each great person type provides different bonus:
  - Scientist: +0.3 knowledge amplification
  - Philosopher: +0.2 knowledge + +1 happiness
  - Merchant: +0.1 knowledge + +0.5% gold generation

#### With Events
- **Insight event**: 33% chance per day when great person present — knowledge +15, happiness +2
- **Omen event**: Story fire predicts seasonal changes — accurate forecast affects farm preparation
- **First Frost**: Story fire provides warmth — reduces winter knowledge penalty by 50%
- **Wolf event**: Storytelling distracts wolves — 50% chance wolf pack moves on without attack

### 4. Gameplay Balance & Alpha 0x Tuning

#### Early Game Impact (Days 1-100, after language tech)
- **Knowledge generation**: 0.5/day — accelerates tech research significantly in early epochs
- **Tech unlock speed**: With story fire, language tech takes ~30% less time to research
- **Great person magnet**: Attracts scientists and philosophers, creating knowledge feedback loop

#### Mid-Game Transition (Days 100-200)
- **Evolution decision**: Academy for research-focused civilization, story circle for culture/happiness, digital archive for future prep
- **Knowledge race**: Players with story fire advance faster in tech tree — strategic advantage
- **Great person competition**: Multiple story fires competing for great person visits

#### Late Game (Days 200+)
- **Academy relevance**: 2.2 knowledge/day useful through classical/medieval for mid-tier techs
- **Digital archive**: 5.0 knowledge/day essential for future epochs and space research
- **Story circle**: Ongoing happiness + knowledge blend useful for cultural victory conditions
- **Obsolescence**: Original story fire becomes secondary to larger knowledge buildings, but retains unique cultural mechanics

### 5. Alpha 0x Visual & Audio

#### Evolution Visuals
- **Original story fire**: Simple fire pit, smoke, basic seating around perimeter
- **Academy**: Grand building with columns, rows of tablets, podium, library shelves, portraits of great thinkers
- **Story Circle**: Ring of standing stones, painted drums, decorative symbols, fire in center, ambient lighting
- **Digital Archive**: Glass-walled room, floating holograms, server racks behind glass, ambient glow, sleek modern design

#### Seasonal Appearance
- **Spring**: New stories being learned, fresh green decorations, blooming around site
- **Summer**: Longer storytelling sessions, fire burns later into evening, outdoor gatherings
- **Autumn**: Harvest stories shared, decorations change, preparation for winter stories
- **Winter**: Indoor gatherings, fire central, warmth radiating, cozy atmosphere

#### Sound Effects
- Crackling fire sounds
- Storyteller voice lines (different tales per season)
- Auditorium ambience (academy)
- Holographic interfaces (digital archive)
- Drum beats and chanting (story circle)

### 6. Alpha 0x AI Integration

#### Villager AI Priorities
1. **Knowledge seeking**: Visiting story fire when seeking knowledge boost
2. **Social gathering**: Residents gather for storytelling when boredom > 40 or happiness need
3. **Great person attraction**: AI sends villagers to story fire when great person is present
4. **Seasonal adaptation**: Winter increased visits for warmth, summer increased evening visits

#### Great Person AI
- **Priority targeting**: Great people actively seek story fires for knowledge amplification
- **Visit duration**: Longer visits (5+ days) provide greater bonuses
- **Knowledge transfer**: Each great person type leaves lasting effect (permanent +0.1 or temporary boosts)
- **Rival competition**: Other civilizations' great people may compete for same story fire

#### RNG Seed Integration
- Story fire seed determines **cultural narrative patterns** — affects which great people are attracted
- Different seed values produce different "cultural specializations" (scientific, philosophical, artistic, etc.)
- Great person visits create cumulative knowledge that influences entire civilization's research direction

### 7. Alpha 0x Achievements & Milestones

#### Building Milestones
- **First Story**: Build story fire and generate 10 knowledge
- **Keeper of Tales**: Evolve to story circle
- **Seat of Learning**: Evolve to academy
- **Infinite Archive**: Evolve to digital archive
- **Cultural Preservation**: Maintain story fire through all 10 epochs

#### Knowledge Milestones
- **First Discovery**: Research first technology with story fire assistance
- **Rapid Advancement**: Unlock 5 technologies before opponent with story fire
- **Cultural Heritage**: Preserve 1000 knowledge across game
- **Archive Keeper**: Maintain digital archive through 500+ days

### 8. Alpha 0x Modding Support

#### Extendable Properties
Modders can add:
- **New evolution paths** via `evolve` property
- **Seasonal modifiers** via `season` property
- **Great person bonuses** via `great_person_boost` property
- **Knowledge scaling** via `knowledge_scaling` property (formula per era)

#### Example Mod Addition
```javascript
// Modder-added story fire variant
story_fire_epic: {
  name: 'Эпический костер',
  cost: { wood: 15 },
  workers: 3,
  out: { knowledge: 1.0 },
  special: 'epic_tales',
  req: 'language',
  desc: 'Knowledge +1.0, great person amplification ×2, longer tales'
}
```

#### Cultural Memory System
```javascript
// Modder-created persistent knowledge
cultural_memory: {
  name: 'Память цивилизации',
  special: 'persistent_knowledge',
  effect: 'legacy_knowledge',
  value: 0.1,  // 0.1 knowledge permanent per era completed
  req: 'education'
}
```

### Summary
The Alpha 0x **story fire** transforms oral tradition into a formal knowledge generation system that scales throughout all 10 epochs. From humble tale-sharing around flames to digital archives preserving entire civilization history, the evolution path reflects humanity's journey from spoken word to recorded knowledge. Each variant offers distinct strategic flavor: the research academy, the cultural story circle, or the digital future archive — allowing players to shape their civilization's intellectual trajectory.

*From oral tradition to digital archive — the evolution of human knowledge, Alpha 0x upgraded.*