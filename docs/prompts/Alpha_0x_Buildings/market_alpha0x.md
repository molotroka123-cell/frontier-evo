# Alpha 0x Building: market

## Basic Info
- **ID**: market
- **Name**: Рынок
- **Era**: Classical Era (Era 3) — unlocks after `trade` technology
- **Cost**: 25 wood + 10 stone
- **Workers**: 3 per shift
- **Daily Output**: +0.8 gold per day
- **Special**: Resource exchange — enables trading surplus resources for gold
- **Requirement**: `trade` technology must be researched
- **Evolves Into**: bazaar, stock exchange

## Alpha 0x Logic Enhancements

### 1. Resource Exchange System
- **Trade Radius**: 6-tile radius — resources within range can be exchanged
- **Exchange Rates**: Fixed rates based on resource abundance/scarcity
  - Food → Gold: 5 food = 1 gold (abundant food cheap)
  - Wood → Gold: 8 wood = 1 gold (common resource)
  - Stone → Gold: 12 stone = 1 gold (moderate abundance)
  - Steel → Gold: 20 steel = 1 gold (rare, high value)
- **Surplus Detection**: Automatically identifies excess resources from connected buildings
- **Caravan Trigger**: Market surplus automatically summons caravans (if port/warehouse nearby)

### 2. Evolution Path (Alpha 0x Upgrade System)
The market can evolve into **3 different directions** based on economic focus:

#### Evolution A: Bazaar (cultural-economic evolution)
- **New Name**: Базар
- **Cost**: 30 wood + 15 stone + 5 gold
- **Workers**: 4 (increased from 3)
- **Daily Output**: +1.2 gold + +1 happiness per day
- **Special**: Cultural marketplace — attracts traders, increases city happiness, rare resource access
- **Visual**: Colorful stalls, merchant tents, decorative fabrics, entertainment area
- **Unlock**: Available when happiness > 15 and trade tech researched

#### Evolution B: Stock Exchange (financial evolution, requires `corporations`)
- **New Name**: Биржа
- **Cost**: 180 stone + 200 gold (corporations tech required)
- **Workers**: 5 (increased from 3)
- **Daily Output**: +2.0 gold per day × corporations multiplier
- **Special**: Investment system — gold generates more gold, stock market mechanics, risk/reward
- **Visual**: Trading floor, ticker tape, digital displays, broker offices, bustling activity
- **Unlock**: Available after corporations tech (era 8)

#### Evolution C: Digital Exchange (requires `internet` technology)
- **New Name**: Онлайн-биржа
- **Cost**: 150 stone + 100 gold + 50 steel (future tech)
- **Workers**: 2 (automated + AI management)
- **Daily Output**: +5.0 gold per day (6.25× original, AI-optimized trading)
- **Special**: Global marketplace — trade with off-world civilizations, instant transactions, AI algorithms
- **Visual**: Holographic trading screens, global connectivity, data streams, sleek modern design
- **Unlock**: Available after internet tech (era 8)

### 3. Alpha 0x Interactions

#### With Other Buildings
- **Market + Farms**: Food surplus — farm excess automatically traded for gold
- **Market + Lumber Mills**: Wood surplus — lumber excess traded, wood price stabilization
- **Market + Quarries**: Stone surplus — stone trading for construction projects
- **Market + Hunter Lodges**: Meat and fur surplus — resource conversion to gold
- **Market + Pastures**: Livestock surplus — food and dairy traded for gold
- **Market + Depots**: Storage integration — depot overflow automatically offered to market
- **Market + Banks**: Compound growth — bank bonuses apply to market trading profits

#### With Technologies & Eras
- **Trade tech prerequisite**: Market cannot be built without `trade` — ensures proper tech progression
- **Era scaling**: Gold output scales (0.8 → 1.2 → 2.0 → 5.0 with AI optimization)
- **Caravan system**: Market surplus → caravans → trade routes → other cities' markets

#### With Events
- **Caravan event**: Market-triggered caravan departs — +50 gold after 15 days, relation bonus
- **Trade disruption**: Pirates/raiders interrupt caravans — -30% gold for 10 days
- **Famine**: Food shortage — market prices spike, food becomes expensive gold purchase
- **Boom**: Economic boom — +50% gold generation for 20 days, investment opportunities

### 4. Gameplay Balance & Alpha 0x Tuning

#### Early Game Impact (Days 150-200, after trade tech)
- **Gold generation**: 0.8 gold/day — early game economy foundation
- **Trade unlock**: Enables first caravans, gold for technology research
- **Resource management**: Player learns to balance production vs trade

#### Mid-Game Transition (Days 200-400)
- **Evolution decision**: Bazaar for culture/happiness + gold, stock exchange for maximum gold, digital for late-game dominance
- **Economic depth**: Players manage trade routes, resource allocation, market timing
- **Competition**: Multiple markets in civilization compete for same resource surpluses

#### Late Game (Days 400+)
- **Bazaar relevance**: 1.2 gold + happiness — useful through Renaissance for economy + culture
- **Stock exchange**: 2.0 gold × corps multiplier — essential for industrial+ economy
- **Digital exchange**: 5.0 gold — endgame, requires internet + corporations, dominates economy
- **Obsolescence**: Original 0.8 gold/day becomes supplemental; evolved versions critical for late-game wealth

### 5. Alpha 0x Visual & Audio

#### Evolution Visuals
- **Original market**: Simple stall, few resources displayed, basic trader area
- **Bazaar**: Colorful marketplace, diverse goods, entertainment area, merchant figures
- **Stock Exchange**: Trading floor, ticker tape, brokers, digital displays, bustling activity
- **Digital Exchange**: Holographic screens, global connectivity, sleek interfaces, AI avatars

#### Seasonal Appearance
- **Spring**: Market freshness — new goods, seasonal items, gardening stalls
- **Summer**: Peak trading, outdoor stalls, festival atmosphere
- **Autumn**: Harvest market — abundant goods, Thanksgiving-style decorations
- **Winter**: Indoor market, heated stoves, warm clothing, cozy atmosphere

#### Sound Effects
- Merchant calls and bargaining
- Coin clinking and transactions
- Crowd murmur and activity
- Ticker tape mechanical sounds (stock exchange)
- Holographic interface sounds (digital exchange)

### 6. Alpha 0x AI Integration

#### Trader AI Priorities
1. **Resource evaluation**: Assess surplus resources within market radius
2. **Trade route planning**: Determine best exchange rates and destinations
3. **Caravan management**: Dispatch/recall caravans based on market needs
4. **Rest**: Return at day's end if energy < 30%

#### Economy AI
- **Price fluctuation**: AI adjusts exchange rates based on resource abundance/ scarcity
- **Surplus prediction**: Forecasts future resource production, pre-emptively trades
- **Inter-city trade**: If multiple cities, optimizes inter-city caravan routes
- **Risk management**: Evaluates event risks (disruptions, famines) before trading

#### RNG Seed Integration
- Market seed determines **trade route patterns** — affects civilization connectivity
- Different seed values produce different "economic specializations" (trading nation vs resource-focused)
- Caravan routes create diplomatic relationships and potential conflict zones
- Economic patterns create long-term wealth distribution across civilization

### 7. Alpha 0x Achievements & Milestones

#### Building Milestones
- **First Trade**: Build market and generate 10 gold
- **Market Maestro**: Evolve to bazaar (happiness + gold)
- **Broker**: Evolve to stock exchange (maximize gold output)
- **Global Trader**: Evolve to digital exchange (era 8-9 dominance)
- **Wealth Accumulator**: Accumulate 1000 gold total

#### Economy Milestones
- **First Caravan**: Successfully trade first resource surplus
- **Gold Milestone**: Accumulate 100 gold, 500 gold, 2000 gold
- **Trade Empire**: Establish caravan routes to 5+ other settlements
- **Market Dominance**: Control 50% of civilization's resource trade

### 8. Alpha 0x Modding Support

#### Extendable Properties
Modders can add:
- **New evolution paths** via `evolve` property
- **Exchange rate modifiers** via `trade_rates` property (custom per-resource rates)
- **Happiness bonuses** via `happy_modifier` property
- **Caravan spawn chance** via `caravan_chance` property

#### Example Mod Addition
```javascript
// Modder-added market variant
market_black: {
  name: 'Черный рынок',
  cost: { wood: 20, stone: 12, gold: 10 },
  workers: 3,
  out: { gold: 1.5 },
  special: 'illicit',
  req: 'trade',
  desc: 'Gold +50% but -10% happiness, rare resources only, relation penalty -5'
}
```

#### Resource Priority System
```javascript
// Modder-created resource priority
resource_priority: {
  name: 'Приоритет ресурсов',
  effect: 'trade_rate_modifier',
  value: { food: 1.5, wood: 0.8 },  // 50% better food trades, 20% worse wood trades
  req: 'economics'
}
```

### Summary
The Alpha 0x **market** transforms raw resource production into liquid gold wealth, evolving from simple stall to digital global exchange. The evolution path reflects humanity's financial evolution: local barter → cultural bazaar → institutional stock exchange → digital global marketplace. Each variant offers distinct strategic flavor: the culture-economy blend (bazaar), pure wealth optimization (stock exchange), or endgame dominance (digital exchange) — allowing players to shape their civilization's economic identity and trade empire.

*From barter to blockchain — the evolution of wealth generation, Alpha 0x optimized.*