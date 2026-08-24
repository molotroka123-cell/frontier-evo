# Alpha 0x Mechanic: Diplomatic Congress & Treaties System

## Core Enhancement
Transforms existing diplomatic relations from simple positive/negative scales into **formal Congress system** where player sends delegates, negotiates treaties, and manages international politics with 7 major factions.

### Congress System

#### Annual Congress (Every 50 days)
- **Delegation Sent**: Player chooses 1 delegate from their great people pool
- **Voting Rights**: Each faction votes based on relation score (+relation = more influence)
- **Treaty Proposals**: 3 random treaties proposed per congress
- **Voting Threshold**: Simple majority (4+ of 7 factions) for passage
- **Consequences**: Passed treaties active for 100 days, then require re-vote

#### Treaty Types
1. **Trade Treaty**: +20% caravan frequency between signatories, open borders
2. **Non-Aggression Pact**: -50% chance of enemy attacks from signatory for 50 days
3. **Research Alliance**: +0.2 knowledge/day from shared discoveries between factions
4. **Defense Pact**: Mutual defense — if one attacked, others join war
5. **Resource Sharing**: +10% resource production bonus when trading with signatory
6. **Cultural Exchange**: +3 happiness from shared art/music with signatory population

#### Relation Score System
- **Base Relation**: 0 (neutral) at game start
- **Modifiers**: Diplomacy actions, war, trade, gifts, agenda fulfillment
- **Faction Agendas**: Each faction likes/hates certain playstyles (from existing data)
- **Relation Decay**: -1 per 10 days if no diplomatic contact

### Building Synergies (Alpha 0x Integration)

#### Diplomatic Buildings
- **Treasury**: Generates gift diplomacy power — +5 relation per 100 gold stored
- **Market**: Trade agreements affect caravan routes and resource prices
- **Academy**: Research treaties provide shared knowledge bonuses
- **Barracks**: Military pacts affect troop movement and defense coordination
- **Palace (Wonder)**: +2 relation with all factions, enables special summit treaties

#### Congress Decision Effects
- **Passed Trade Treaty**: Markets of both factions gain +10% efficiency for 100 days
- **Passed Defense Pact**: Barracks can call allied troops to defense (+30% defense bonus)
- **Failed Treaty**: Relation penalty -10 with proposing faction, +5 with others

### Enemy Wave Integration

#### Faction Warfare Cycles
- **Every 150 days**: Faction relationship check — if relations < -30, potential conflict
- **Wave Triggers**: 
  - **Border Clash**: If border cities within 5 tiles of rival faction
  - **Resource Dispute**: If both factions claim same resource tile
  - **Aggression Buildup**: Relation below -50 for 50+ days
- **Wave Types**:
  - **Raid Wave**: Army attacks resource buildings, returns after plunder
  - **Full Invasion**: Army attempts city conquest — requires defense
  - **Diplomatic Isolation**: Faction cuts all trade, -20% economy modifier

#### War Mechanics
- **Declaration**: Player or AI can declare war (relation < -60)
- **War Aims**: Capture resources, destroy buildings, eliminate army
- **Peace Negotiations**: Post-war treaty options with modified terms
- **Total Victory**: Eliminate all units, rebuild required

### Balance & Alpha 0x Tuning
- **Faction Count**: 7 major factions + minor city-states
- **Congress Frequency**: Every 50 days — fits within epoch progression
- **Vote Weight**: Relation score matters — good diplomacy = more influence
- **AI Personality**: Each faction has agenda preferences (war-monger, trader, scientist, etc.)

### Modding Support
- **Treaty Templates**: Modders can add custom treaty types
- **Agenda Modifiers**: Custom faction likes/hates tables
- **Vote Weight Formulas**: Custom relation-to-vote conversions
- **War Trigger Conditions**: Custom conflict initiation rules

### Summary
The Alpha 0x **Diplomatic Congress System** elevates relations from simple meters to **active political gameplay**. Players must manage agendas, send delegates, vote on treaties, and navigate the shifting alliance landscape. Building synergies mean every structure contributes to diplomatic power, while enemy waves create natural conflict cycles tied to relation health.

*From simple relations to living politics — Congress system where every vote shapes your civilization's future.*