using System;
using System.Collections.Generic;

namespace Fixtures.Inventory
{
    /// <summary>Anything that can be restocked.</summary>
    public interface IStocker
    {
        /// <summary>Adds stock and returns the new count.</summary>
        int Restock(int amount);
    }

    /// <summary>Status of an item.</summary>
    public enum Status { Active, Retired }

    /// <summary>One stock item.</summary>
    public class Item : IStocker
    {
        /// <summary>Largest count an item may have.</summary>
        public const int MaxItems = 100;
        private readonly List<string> _log = new List<string>();

        /// <summary>Name of the item.</summary>
        public string Name { get; }
        public int Count { get; private set; }

        /// <summary>Creates an item with a name.</summary>
        public Item(string name)
        {
            Name = Normalize(name);
        }

        /// <summary>Adds stock, capped at MaxItems.</summary>
        public int Restock(int amount)
        {
            Count = Clamp(Count + amount);
            Record("restock");
            return Count;
        }

        private void Record(string evt)
        {
            _log.Add(evt);
        }

        internal static int Clamp(int value)
        {
            return Math.Max(0, Math.Min(value, MaxItems));
        }

        private static string Normalize(string name) => name.Trim().ToLowerInvariant();
    }
}
