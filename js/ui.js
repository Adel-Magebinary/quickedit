(function($) {

/**
 * @file ui.js
 *
 * "Global" UI components: toggle, modal.
 */

Drupal.edit = Drupal.edit || {};


Drupal.edit.toggle = {
  render: function() {
    // TODO: fancy, "physical toggle" to switch from view to edit mode and back.
  }
};


Drupal.edit.modal = {
  create: function(message, $actions, $editable) {
    // The modal should be the only interaction element now.
    $editable.addClass('edit-belowoverlay');
    Drupal.edit.toolbar.get($editable).addClass('edit-belowoverlay');

    $('<div id="edit-modal"><div class="main"><p></p></div><div class="actions"></div></div>')
    .appendTo('body')
    .find('.main p').text(message).end()
    .find('.actions').append($actions);
  },

  get: function() {
    return $('#edit-modal');
  },

  remove: function() {
    Drupal.edit.modal.get().remove();

    // Make the other interaction elements available again.
    $('.edit-belowoverlay').removeClass('edit-belowoverlay');
  }

};


})(jQuery);
