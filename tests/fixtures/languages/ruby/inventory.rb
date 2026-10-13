# frozen_string_literal: true

# Ruby fixture of the language conformance suite.
module Inventory
  # Largest count an item may have.
  MAX_ITEMS = 100

  # Keeps a count inside the allowed range.
  def self.clamp(value)
    [[value, 0].max, MAX_ITEMS].min
  end

  # One stock item.
  class Item
    attr_reader :name, :count

    # Creates an item with a normalized name.
    def initialize(name)
      @name = normalize(name)
      @count = 0
      @log = []
    end

    # Adds stock, capped at MAX_ITEMS.
    def restock(amount)
      @count = Inventory.clamp(@count + amount)
      record :restock
      @count
    end

    def empty?
      @count.zero?
    end

    private

    def record(event)
      @log << event
    end

    def normalize(name)
      name.strip.downcase
    end
  end

  # An item that expires.
  class Perishable < Item
    def expired?(days_left)
      days_left <= 0
    end
  end
end
