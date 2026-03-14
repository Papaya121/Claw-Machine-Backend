insert into rewards (code, rarity, weight, is_active, stock)
values
  ('TOY_COMMON_BEAR', 'common', 600, true, null),
  ('TOY_RARE_CAT', 'rare', 250, true, 1000),
  ('TOY_EPIC_DINO', 'epic', 120, true, 350),
  ('TOY_LEGENDARY_DRAGON', 'legendary', 30, true, 50)
on conflict (code) do update
set rarity = excluded.rarity,
    weight = excluded.weight,
    is_active = excluded.is_active,
    stock = excluded.stock;
