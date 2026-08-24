# Master Prompt from DS — Project Evolution Alpha 0x

## IDEA
Elevate Project Evolution to AAA by doubling buildings (58→116), creating meaningful progression from Stone Age to interstellar civilization where every structure matters, evolves, and impacts economy/military/knowledge/happiness across 10 epochs.

## LOGIC
- **Data-driven design**: All buildings in `app/src/core/data.js` BUILDINGS object
- **Doubling strategy**: Each original building gets variants/upgrades unlocked through tech progression
- **38 new building types** filling gaps: windmill, beehive, dye hut, advanced mills, water treatment, etc.
- **Epoch-gated unlocks**: Each era introduces new building tiers
- **Evolution system**: Player chooses upgrade paths (e.g., farm→organic→greenhouse→vertical→nutrient lab)
- **Building auras/radii**: Smithy, mill, university affect neighboring structures
- **Resource chains**: Steel (mine→smelter→foundry→factory→nanofactory), Knowledge (campfire→story fire→academy→university→data center→neural core), Food (farm→irrigated→greenhouse→vertical→nutrient)
- **7 unique wonders** per era + future (stone circle, stonehenge, fortress, temple of apollo, castle keep, observatory, factory spire, megatower, server spire, spire of civilization)
- **Population-housing balance**: Scales from hut(4)→house(8)→apartment(24)→skyscraper(40)
- **100% data-driven**: Modders add buildings via JSON schema, no code changes

## EXECUTION
### Phase 1 (Weeks 1-2): Core Data
- Double all 58 existing building entries in data.js
- Add 38 new building types with full property sets
- Update BUILDING_ERA_IDX mapping
- Test all buildings load without errors

### Phase 2 (Weeks 3-4): Evolution System
- Implement building evolution logic in simulation.js
- Add epoch-gated unlock conditions
- Create evolution UI preview system
- Balance costs and outputs across all variants

### Phase 3 (Weeks 5-6): Aura & Radius
- Implement building aura effects (Smithy, Mill, University)
- Create radius visualization in UI
- Test multi-building aura interactions
- Balance bonus stacking limits

### Phase 4 (Weeks 7-8): Wonders
- Add 7 unique wonder buildings (one per era + future)
- Implement special abilities per wonder
- Create wonder construction requirements
- Test Spire completion condition (game-end)

### Phase 5 (Weeks 9-10): Interdependencies
- Create resource chain logic (steel, knowledge, food chains)
- Implement synergy bonuses between connected buildings
- Add trade route dependencies on market/network buildings
- Balance economy with doubled building count

### Phase 6 (Weeks 11-12): UI/UX
- Update building drawer to show 116 options
- Create upgrade/evolution interface
- Add era-filtering and search in building menu
- Tutorial prompts for new building types

### Phase 7 (Weeks 13-16): Balance & Playtesting
- Economy balancing with doubled resources
- Military balance with additional troop buildings
- Knowledge progression speed with more research buildings
- Happiness management with entertainment options
- Extended playtesting through multiple epochs

### Phase 8 (Weeks 17-20): Polish & Optimization
- Performance testing with full 116-building cities
- Visual polish on new building models/animations
- Sound effects for new building types
- Achievement system for building milestones
- Documentation and modding guidelines

## AAA-Level Features Checklist
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

## Testing Milestones
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

## Modding Support
All buildings 100% data-driven. Modders can:
- Add new building types in data.js BUILDINGS object
- Define epoch requirements via TECHS prerequisites
- Create evolution chains using `evolve` property
- Define aura radii and effects via `aura` property
- Create wonder buildings with `unique: true`
- Balance costs in `cost` object
- Add seasonal/worker properties

New buildings only need to follow existing schema - no code changes required.

*Generated from analysis of existing Project Evolution codebase (58 buildings, 10 epochs, data-driven architecture). Doubled to 116 buildings with 38 new types, epoch-gated progression, evolution systems, and interconnected gameplay systems designed to elevate the game to AAA quality.*