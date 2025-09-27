export const generateHelloCanvas = (): string => `#include <furi.h>
#include <gui/gui.h>
#include <gui/view_port.h>
#include <gui/canvas.h>
#include <input/input.h>
#include <notification/notification.h>
#include <notification/notification_messages.h>
#include <furi/core/log.h>

static volatile bool running = true;

static void draw_callback(Canvas* canvas, void* ctx) {
    (void)ctx;
    canvas_clear(canvas);
    canvas_set_font(canvas, FontPrimary);
    canvas_set_color(canvas, ColorBlack);
    canvas_draw_str(canvas, 10, 22, "Hello from Blockly!");
}

static void input_callback(InputEvent* event, void* ctx) {
    (void)ctx;
    if(event->type == InputTypeShort && event->key == InputKeyBack) {
        running = false;
    }
}

// App entry point (pure C)
int32_t app_main(void* p) {
    (void)p;
    FURI_LOG_I("APP", "Hello Canvas start");

    Gui* gui = furi_record_open(RECORD_GUI);
    NotificationApp* notif = furi_record_open(RECORD_NOTIFICATION);

    ViewPort* vp = view_port_alloc();
    view_port_draw_callback_set(vp, draw_callback, NULL);
    view_port_input_callback_set(vp, input_callback, NULL);
    view_port_enabled_set(vp, true);
    gui_add_view_port(gui, vp, GuiLayerFullscreen);

    while(running) {
        furi_delay_ms(50);
    }

    notification_message(notif, &sequence_success);

    gui_remove_view_port(gui, vp);
    view_port_free(vp);
    furi_record_close(RECORD_GUI);
    furi_record_close(RECORD_NOTIFICATION);

    FURI_LOG_I("APP", "Goodbye");
    return 0;
}
`;

// Future: add parameterized generators (title text, layout, additional blocks)
