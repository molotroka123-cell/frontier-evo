# Alpha 0x Mechanic: Nemesis Rival System

## Core Enhancement
Introduces **persistent rival civilization** that evolves alongside player's campaign, creating personal story and long-term conflict beyond random enemy armies.

### Rival Civilization System

#### Rival Selection
- **Automatic Assignment**: At game start, 1 of 7 factions selected as "Nemesis"
- **Hidden Profile**: Rival has hidden stats (military strength, economy, technology level)
- **Personal Agenda**: Rival has specific victory condition (conquest, cultural, scientific, economic)
- **Relation Tracker**: Separate from regular diplomacy — starts at -20 (rivalry)

#### Rival Evolution
- **Era Scaling**: Rival power scales with player's era — starts Stone Age, grows through epochs
- **Tech Research**: Rival researches technologies — sometimes different path than player
- **City Expansion**: Founds new cities — player can scout and monitor growth
- **Wonder Competition**: Rival builds wonders — player can steal ideas or compete

#### Rival Actions
- **Resource Theft**: Steals 10% of random resource type per 50 days if undetected
- **Spy Missions**: Sabotage buildings, steal technology, incite unrest (risk vs reward)
- **Army Pushing**: Sends army waves every 100 days — scouting required
- **Diplomatic Pressure**: Other factions influenced against player ("Turn them against you")

### Building Synergies (Alpha 0x Integration)

#### Anti-Rival Buildings
- **Watchtower (new building)**: Increases scouting range +2 tiles, detects rival army movement
- **Barracks (upgraded)**: +20% unit production when rival active — prepare for conflict
- **Academy**: Rival tech path research — counter-espionage unlocks
- **Market**: Monitor rival resource theft patterns
- **Palace (Wonder)**: Reveals rival's current agenda and power level

#### Rival Intelligence
- **Scout Towers**: reveal rival city locations and unit movements
- **Diplomatic Spies**: Hidden agents — can sabotage or steal tech (with capture risk)
- **Intelligence Network**: Network of buildings provides continuous rival status updates

### Enemy Wave Integration

#### Rival Wave Patterns
- **Every 80 days**: Rival sends army wave — scale based on their era vs player's era
- **Wave Scaling**:
  - **Era Equal**: Standard army size (similar to random events)
  - **Era Ahead**: Larger army (player leading in tech)
  - **Era Behind**: Smaller army but special tactics
- **Wave Types**:
  - **Scouting Party**: 3-5 units — reconnoitering, no attack if defended
  - **Raid Force**: 8-12 units — target resource buildings, retreat after 20 days
  - **Invasion Army**: 15-25 units — attempt city conquest, persistent until defeated

#### Counter-Wave Mechanics
- **Defensive Structures**: Walls, towers provide defense bonuses vs rival waves
- **Army Prepositioning**: Keep army near borders — reduces wave success chance
- **Treaty Options**: Non-aggression pact with rival reduces wave frequency by 50%
- **Preemptive Strike**: Player can declare war first — choose engagement timing

### Balance & Alpha 0x Tuning
- **Rival Power Curve**: Starts weak, grows to challenge player by era 5-6, endgame threat
- **Detection Threshold**: Player can choose how much to invest in scouting vs economy
- **Difficulty Scaling**: Higher difficulty = earlier rival aggression, stronger waves
- **Loss State**: If rival reaches their victory condition before player wins — game over (or continue vs rival)

### Modding Support
- **Rival Agenda Templates**: Custom victory conditions for rivals
- **Power Scaling Formulas**: Custom era-based power adjustment
- **Spy Mission Types**: Additional sabotage/steal options
- **Wave Patterns**: Custom attack intervals and unit types

### Summary
The Alpha 0x **Nemesis Rival System** creates **personal narrative** within each campaign. Players face not just generic enemies, but a specific rival civilization with history, agenda, and evolving threat. Building synergies focus on intelligence and preparation, while enemy waves create tense moments of "is my defense ready?" This system makes every playthrough unique — your rival could be the aggressive wolves faction, the scientific guild, or the cultural dawn order.

*Your personal rival — evolving alongside your civilization from first fire to spaceport.*