# Alpha 0x Mechanic: Dynamic Resource Scarcity & Market Economy

## Core Enhancement
Transforms static resource costs into **live market economy** where supply/demand fluctuates based on production, consumption, events, and global state — making every resource decision meaningful.

### Market Economy System

#### Price Formation
- **Base Prices**: Resources have fixed base values (from existing MARKET_BASE: food 0.1, wood 0.125, stone 0.167, steel 4.0 gold/unit)
- **Supply Modifier**: +price per 10% excess production civilization-wide
- **Demand Modifier**: -price per 10% consumption below civilization needs
- **Global Stockpile**: Total accumulated resources across all cities affects price

#### Daily Price Fluctuation
- **Price Range**: ±25% from base price each day
- **Calculation**: Base × (1 + supply_modifier + demand_modifier + event_modifier)
- **Visual Indicator**: Market building shows up/down arrows with percentage change
- **Player Information**: Tooltip shows "Why: +30% wood (forest depletion + 3 new cities)"

#### Resource Categories & Behavior
1. **Food (perishable)**: High volatility — spoilage mechanic, price spikes during famine
2. **Wood (renewable)**: Medium volatility — regrowth affects long-term price trend
3. **Stone (finite)**: Low volatility — depletion permanent until regrowth events
4. **Steel (produced)**: Medium-high volatility — production chain complexity

#### Scarcity Events
- **Shortage**: Price ×1.5, buildings consume more gold for same resources
- **Surplus**: Price ×0.5, selling resources more profitable
- **Famine**: Price ×2, food buildings get +20% yield bonus (desperation mode)
- **Boom**: Price ×0.3, resource acquisition cheap but inflation risk

### Building Synergies (Alpha 0x Integration)

#### Market & Trade Buildings
- **Market**: Benefits from price fluctuations — buys low, sells high
- **Stock Exchange**: Advanced market — ±40% price range, futures trading
- **Depot**: Stores resources at current price — value changes daily
- **Warehouse (new)**: Larger capacity, preserves resource value for 30 days

#### Production Buildings
- **Lumber Mill**: Price-affected output — when wood prices high, workers efficiency +10% (conservation incentive)
- **Mine**: Depletion increases price over time — deep mining unlocks new veins
- **Quarry**: Same as mine — finite resource with price climb
- **Farm**: Food price affects farmer productivity — hunger motivation bonus

#### New Building Concepts
- **Silos**: Storage building — preserves food value, prevents spoilage, +10% food price stability
- **Exchange**: Player-traded resource conversion — exploit price differences between resources
- **Refinery**: Upgrade mine/quarry — extends resource life but higher construction cost

### Enemy Wave Integration

#### Economy-Targeted Waves
- **Resource Raid**: Enemy army targets your stockpiles — if successful, random resource -30% for 50 days
- **Inflation Event**: Civil war in neutral faction — your gold value reduced 20% for 30 days
- **Supply Disruption**: Trade routes blocked — caravan frequency -50% for 20 days

#### Economic War Strategies
- **Embargo**: Player can embargo rival — their resource prices ×1.5, yours ×0.8 (diplomatic action)
- **Price Manipulation**: Spy actions can artificially shift prices ±15% for 15 days
- **Stockpile Defense**: Defensive buildings protect resource storage from raids

### Balance & Alpha 0x Tuning
- **Price Range**: ±25% normal, ±40% during events — significant but not crippling
- **Update Frequency**: Prices recalculate each day dawn — player sees morning market report
- **Civilization Size Modifier**: Larger civs = smaller percentage fluctuations (more stable)
- **Difficulty Scaling**: Higher difficulty = larger price swings, more frequent events

### Modding Support
- **Price Formulas**: Custom supply/demand calculations
- **Event Triggers**: Additional scarcity/boom event types
- **Resource Categories**: Add new resource types with unique behavior
- **Market Templates**: Custom building interactions with economy

### Summary
The Alpha 0x **Dynamic Resource Scarcity System** makes every wood, stone, food, and steel decision meaningful through living prices. Players must speculate, stockpile, trade strategically, and adapt to market changes. Building synergies connect production to consumption economics, while enemy waves target economic stability. This system creates emergent gameplay — "wood prices spiked, so I built more farms," "gold surplus, time to expand army."

*From fixed costs to living economy — prices that rise and fall with your civilization's success.*