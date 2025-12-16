from . import tag_groups, states, settings, vn, presets, general

def register_routes(blueprint, plugin):
    tag_groups.register_routes(blueprint, plugin)
    states.register_routes(blueprint, plugin)
    settings.register_routes(blueprint, plugin)
    vn.register_routes(blueprint, plugin)
    presets.register_routes(blueprint, plugin)
    general.register_routes(blueprint, plugin)
