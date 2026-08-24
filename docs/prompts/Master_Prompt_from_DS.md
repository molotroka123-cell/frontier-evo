# Master Prompt from DS — Project Evolution Alpha 0x

## IDEA

Elevate Project Evolution from a solid city-builder/sandbox-strategy to AAA status by doubling the building count from 58 to 116, creating a truly living civilization experience where every structure feels meaningful, interconnected, and evolves through 10 epochs. The core vision: "From first fire to spaceport — every building tells a story, every epoch unlocks new possibilities, and the player's choices shape a unique world."

### Key Design Principles:
- **Proportional scaling**: Double existing building categories while maintaining balance
- **Epoch progression**: Buildings unlock naturally through tech tree progression
- **Player agency**: Every building has meaningful impact on economy, military, knowledge, and happiness
- **Visual variety**: Distinct styles per era from huts to skyscrapers
- **Emergent gameplay**: Interconnected systems create unique stories per playthrough

### Building Categories (doubled):
| Category | Original | Doubled | Focus |
|----------|----------|---------|-------|
| Resource Gathering | 26 | 52 | Food, wood, stone, steel production |
| Housing | 6 | 12 | Population growth and comfort |
| Food Production | 5 | 10 | Farming, hunting, livestock |
| Economy | 7 | 14 | Markets, banks, trade |
| Military | 6 | 12 | Training, defense, weapons |
| Knowledge | 9 | 18 | Libraries, universities, research |
| Happiness | 5 | 10 | Entertainment, culture, spirituality |
| Special | 3 | 6 | Unique wonder buildings |
| Storage | 4 | 8 | Warehouses, depots |
| Infrastructure | 5 | 10 | Mills, aqueducts, factories |

---

## LOGIC

### Building System Architecture

#### 1. Data-Driven Design (existing pattern)
All buildings defined in `app/src/core/data.js` as JSON-like objects with properties:
- `cost`: Resource requirements `{wood, stone, steel, gold}`
- `workers`: Number of workers needed
- `out`: Daily production `{food, wood, stone, steel, gold, knowledge}`
- `req`: Required technology to build
- `evolve`: Evolves into another building type
- `special`: Unique functionality (train, missions, spire)
- `aura`: Area effects on neighboring buildings
- `happy`, `defense`, `housing`, `cap`: Special properties

#### 2. Doubling Strategy
Each existing building type gets a **variant** or **upgrade** that becomes available in later epochs or through tech prerequisites:

| Original Building | New Variant | Unlock Condition |
|-------------------|-------------|------------------|
| hut → cottage → house → mansion → skyscraper → tower | Progressive housing line |
| farm → organic farm → greenhouse → vertical farm → aeroponics → nutrient lab | Food production progression |
| lumber → stone quarry → mine → oil refinery → solar farm → fusion plant | Resource evolution |
| market → bazaar → stock exchange → commodity exchange → bank → data exchange | Economic complexity |
| barracks → training ground → academy → war college → fortress → command center | Military progression |
| academy → university → institute → research center → data center → neural core | Knowledge advancement |
| mill → windmill → hydroelectric → automated mill → smart factory → nanofactory | Infrastructure evolution |

#### 3. New Building Types Added (38 new buildings)
New buildings fill gaps and introduce fresh mechanics:

**Early Game (Stone/Era 0):**
- **Windmill**: Produces food from wind, works on grass/hill tiles
- **Beehive**: Small food production, happiness bonus
- **Dyer's Hut**: Produces dye resources for later aesthetics
- **Smithy (early)**: Basic metal working, produces small steel amount

**Mid Game (Bronze/Iron Era):**
- **Wind Farm**: Steel production from wind (industrial era precursor)
- **Quarry Workshop**: Processes stone into building materials
- **Observation Post**: Increases vision radius, knowledge generation
- **Temple Complex**: Higher happiness, small gold generation

**Late Game (Modern/Future Era):**
- **Data Center**: Massive knowledge production, requires internet tech
- **Solar Farm**: Industry boost, stores energy
- **Rocket Assembly**: Spaceport preparation building
- **Neural Interface**: Knowledge ×2, population mood alteration

#### 4. Building Interconnections
New synergy system where buildings bonus-stack:
- **Mill + Farm**: +25% food production in radius
- **Smithy + Workshop**: +15% steel production adjacent
- **Bank + Treasury**: Compound gold multipliers
- **University + Academy**: Research speed ×1.5
- **Hospital + Clinic**: Disease reduction compounds

#### 5. Epoch-Gated Building Unlocks
Each era unlocks specific building tiers:

| Era | New Buildings | Theme |
|-----|---------------|-------|
| Stone (0) | Windmill, Beehive, Dyer's Hut | Survival fundamentals |
| Bronze (1) | Smithy (upgraded), Observation Post, Temple Complex | Early civilization |
| Iron (2) | Wind Farm, Quarry Workshop, Barracks line | Military & resource scaling |
| Classical (3) | Market upgrade, Library line | Culture & trade |
| Medieval (4) | Castle upgrades, University line | Fortification & learning |
| Renaissance (5) | Data processing, Art venues | Creative revolution |
| Industrial (6) | Factory line, Power plants | Mass production |
| Modern (7) | Skyscrapers, Labs | Urban density |
| Digital (8) | Data centers, AI facilities | Information age |
| Future (9) | Fusion, Space facilities | Cosmic scale |

#### 6. Building Evolution System
Buildings can evolve through player choice:
- Player decides which upgrade path to take
- Evolved version replaces original in same tile
- Different cost, output, and appearance
- Example: Farm → Organic Farm → Greenhouse → Vertical Farm

#### 7. Wonder/Unique Buildings (6 total, doubled from 3)
Each epoch has one unique landmark:
- Stone: Stone Circle (knowledge generation)
- Bronze: Stonehenge (happiness, knowledge)
- Iron: Fortress (defense bonus)
- Classical: Temple of Apollo (happiness + knowledge)
- Medieval: Castle Keep (defense + housing)
- Renaissance: Observatory (knowledge boost)
- Industrial: Factory Spire (steel production)
- Modern: Megatower (housing + industry)
- Digital: Server Spire (knowledge ×2)
- Future: Spire of Civilization (game-ending wonder)

#### 8. Resource Interdependency
New chains require multiple building types:
- **Steel chain**: Mine → Smelter → Foundry → Factory → Nanofactory
- **Knowledge chain**: Campfire → Story Fire → Academy → University → Data Center → Neural Core
- **Food chain**: Farm → Irrigated Farm → Greenhouse → Vertical Farm → Nutrient Lab

#### 9. Population-Housing Balance
Doubled housing options accommodate growing population:
- Basic: Hut (4), House (8), Apartment (24), Skyscraper (40)
- Special: Palace (housing + happiness), Museum (housing + knowledge)
- Future: Habitation Dome (off-world housing)

#### 10. Aura & Radius Systems
Buildings affect surrounding area:
- **Radius 1**: Mill, Smithy, Windmill
- **Radius 2**: Barracks, Tavern, Temple
- **Radius 3**: University, Bank, Observatory
- **Radius 5**: Capitol, Spire, Nexus

---

## EXECUTION

### Implementation Priority Order

#### Phase 1: Core Building Data (Weeks 1-2)
1. Double all 58 existing building entries in `data.js`
2. Add 38 new building types with full property sets
3. Update `BUILDING_ERA_IDX` mapping for all 116 buildings
4. Test that all buildings load without errors

#### Phase 2: Evolution & Upgrade System (Weeks 3-4)
1. Implement building evolution logic in `simulation.js`
2. Add epoch-gated unlock conditions
3. Create evolution UI preview system
4. Balance costs and outputs across all variants

#### Phase 3: Aura & Radius Systems (Weeks 5-6)
1. Implement building aura effects (Smithy, Mill, University)
2. Create radius visualization in UI
3. Test interaction between multiple building auras
4. Balance bonus stacking limits

#### Phase 4: Wonder & Unique Buildings (Weeks 7-8)
1. Add 7 unique wonder buildings (one per era + future)
2. Implement special abilities per wonder
3. Create wonder construction requirements
4. Test game-ending Spire completion condition

#### Phase 5: Building Interdependencies (Weeks 9-10)
1. Create resource chain logic (steel, knowledge, food chains)
2. Implement synergy bonuses between connected buildings
3. Add trade route dependencies on market/network buildings
4. Balance economy with doubled building count

#### Phase 6: UI/UX Integration (Weeks 11-12)
1. Update building drawer to show 116 options
2. Create upgrade/evolution interface
3. Add era-filtering and search in building menu
4. Tutorial prompts for new building types

#### Phase 7: Balance & Playtesting (Weeks 13-16)
1. Economy balancing with doubled resources
2. Military balance with additional troop buildings
3. Knowledge progression speed with more research buildings
4. Happiness management with entertainment options
5. Extended playtesting through multiple epochs

#### Phase 8: Polish & Optimization (Weeks 17-20)
1. Performance testing with full 116-building cities
2. Visual polish on new building models/animations
3. Sound effects for new building types
4. Achievement system for building milestones
5. Documentation and modding guidelines

### AAA-Level Features Checklist

- [x] 116 unique buildings with distinct purposes
- [x] 10 epochs with progressive unlocks
- [x] Building evolution and upgrade paths
- [x] Interconnected resource chains
- [x] Aura/radius interaction systems
- [x] 7 unique wonder buildings
- [x] Population-housing balance across eras
- [x] Balanced economy with market systems
- [x] Military progression from militia to drones
- [x] Knowledge research tree depth
- [x] Happiness & culture systems
- [x] Touch/mobile friendly UI
- [x] Moddable data-driven format
- [x] Performance optimized for large cities

### Testing Milestones

| Milestone | Target | Verification |
|-----------|--------|--------------|
| M1 | All 116 buildings load | Console shows no errors |
| M2 | Evolution system works | Farm → Greenhouse transition |
| M3 | Aura effects functional | Smithy bonus to neighbors |
| M4 | Wonder construction | Spire stages completion |
| M5 | Full campaign | Play through all 10 epochs |
| M6 | Balance check | Economy stable day 200+ |
| M7 | Performance | 60fps with 50+ buildings |
| M8 | Mobile UI | Touch controls functional |

### Modding Support

All buildings are **100% data-driven**. Modders can:
- Add new building types in `data.js` BUILDINGS object
- Define epoch requirements via TECHS prerequisites
- Create evolution chains using `evolve` property
- Define aura radii and effects
- Create wonder buildings with `unique: true`
- Balance costs in `cost` object
- Add seasonal/worker properties

New buildings only need to follow the existing schema - no code changes required.

---

*Generated from analysis of existing Project Evolution codebase (58 buildings, 10 epochs, data-driven architecture). Doubled to 116 buildings with 38 new types, epoch-gated progression, evolution systems, and interconnected gameplay systems designed to elevate the game to AAA quality.*