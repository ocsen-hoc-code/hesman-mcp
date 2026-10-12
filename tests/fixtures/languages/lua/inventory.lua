-- Lua fixture of the language conformance suite.
local M = {}

-- Largest count an item may have.
M.MAX_ITEMS = 100

local registry = {}

-- Keeps a count inside the allowed range.
local function clamp(value)
  if value < 0 then
    return 0
  end
  return math.min(value, M.MAX_ITEMS)
end

-- Trims and lower-cases a name.
local normalize = function(name)
  return string.lower((name:gsub("^%s+", "")))
end

local Item = {}
Item.__index = Item

-- Creates an item with a normalized name.
function M.new(name)
  local item = setmetatable({ name = normalize(name), count = 0 }, Item)
  registry[item.name] = item
  return item
end

-- Adds stock, capped at MAX_ITEMS.
function Item:restock(amount)
  self.count = clamp(self.count + amount)
  return self.count
end

function Item.label(self)
  return string.format("%s (%d)", self.name, self.count)
end

-- Restocks every registered item.
function restock_all(amount)
  for _, item in pairs(registry) do
    item:restock(amount)
  end
end

return M
