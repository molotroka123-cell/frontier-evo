# Alpha 0x Mechanic: Population Morale & Civil Unrest System

## Core Enhancement
Deepens existing happiness system into **comprehensive morale framework** where population satisfaction affects productivity, loyalty, and can trigger civil events ranging from strikes to full rebellions.

### Morale System Foundation

#### Core Metrics
- **Happiness (0-100)**: Existing metric — foundation for morale
- **Morale (-50 to +50)**: New hidden modifier — modifies all productivity by 1% per point
- **Satisfaction Tiers**: 
  - **Thriving**: +20 morale (happiness 80-100) — +20% productivity, -5% upkeep
  - **Content**: +0 morale (happiness 40-79) — normal productivity
  - **Stressed**: -20 morale (happiness 20-39) — -20% productivity, +10% resource consumption
  - **Rebellious**: -40 morale (happiness 0-19) — -40% productivity, +25% upkeep, event triggers

#### Morality Decay/Gain
- **Daily Decay**: -1 morale per 100 population if needs unmet
- **Building Bonuses**: Each happy-building contributes morale radius effect
- **Seasonal Impact**: Winter -10 morale, Summer +5, Spring/Autumn 0
- **Event Modifiers**: Major events can shift morale ±15-30 points

### Unrest Event System

#### Stress Threshold Triggers
- **Mild Stress** (morale < -10): 
  - 25% chance per day of "complaint event"
  - Example: "Workers demand better wages - choose: pay 20 gold + happiness +5, or refuse - morale -5"
- **Moderate Unrest** (morale < -25):
  - 50% chance per day of event
  - Example: "Trade strike - caravans halt for 10 days, -10% gold income"
- **Severe Crisis** (morale < -35):
  - Event guaranteed
  - Example: "Riot in streets - choose: send army (gold cost +pop loss) or concede demands (gold + happiness boost)"

#### Rebellion Types
1. **Food Riots**: When food stockpile < 30 days supply — demand immediate food distribution
2. **Tax Revolts**: When gold tax rate > 30% — demand tax reduction or city secession risk
3. **Work Stoppages**: When morale < -30 — -30% production from affected buildings until demands met
4. **Secession**: Capital city happiness 0 — new "independent city" mechanic (player can reclaim or lose)

### Building Synergies (Alpha 0x Integration)

#### Morale-Enhancing Structures
- **Temple**: +5 happiness radius (5 tiles) — central to happy cities
- **Amphitheater**: +8 happiness, +2 morale — cultural centerpiece
- **Tavern**: +3 happiness, local radius — neighborhood focal point
- **Park/Garden**: +2 happiness, +1 morale per 10 residents nearby — green spaces
- **Palace (Wonder)**: +15 global happiness, +5 morale — seat of civilization

#### Stress-Reducing Buildings (new concepts)
- **Clinic**: -10 morale penalty reduction when disease present
- **Sewers**: Essential for dense cities — prevents -15 morale from overcrowding
- **Housing Upgrades**: Apartment/Skyscraper provide +1 morale per 10 housing beyond basic
- **Market**: Reduces -5 morale from resource scarcity when stocked

#### Morale-Decay Buildings (trade-offs)
- **Prison**: +1 defense, -5 morale (public execution visible)
- **Barracks (heavy presence)**: +10% defense, -3 morale from military state
- **Stock Exchange**: +5% gold generation, -2 morale from wealth inequality

### Enemy Wave Integration

#### Unrest-Triggered Waves
- **Civil War Wave**: If morale < -40 for 20+ days — rival faction may send "liberation army" or internal units turn
- **Bandit Exploitation**: Low morale areas attract bandits — caravan routes threatened, -15% trade
- **Deserter Waves**: Army units have 10% chance to desert per 10 morale points below 0

#### Prevention & Management
- **Proactive Building**: Maintain 60+ happiness through mixed building types
- **Crisis Response**: Emergency measures — gold redistribution, building gifts, policy changes
- **Long-term Solutions**: Urban planning — distribute happy buildings, avoid concentration of negative structures

### Balance & Alpha 0x Tuning
- **Baseline Happiness**: Well-planned city starts at 70 happiness (content morale)
- **Population Scaling**: +1 population = +0.1 morale decay rate — larger cities need more attention
- **Difficulty Scaling**: Higher difficulty = faster morale decay, more frequent events
- **Recovery Rate**: Well-managed cities can recover +5 morale per 10 days with proper measures

### Modding Support
- **Mood Modifiers**: Custom building happiness effects
- **Event Tables**: Custom unrest event types and triggers
- **Decay Formulas**: Custom morale decay per population/era
- **Rebellion Conditions**: Custom thresholds and outcomes

### Summary
The Alpha 0x **Population Morale System** transforms happiness from simple number into **living ecosystem** where every building, season, and event affects citizen well-being. Poor planning leads to cascading consequences — work stoppages, riots, even rebellion. Strategic players maintain balanced city design, distribute amenities, and respond to crises. Building synergies make every structure contribute to citizen quality of life, while enemy waves exploit unrest for added strategic depth.

*From happiness meter to citizen psychology — morale that drives civilization stability or collapse.*