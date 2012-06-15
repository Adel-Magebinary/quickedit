(function ($) {

Drupal.ipe = Drupal.ipe || {};

/**
 * Attach toggling behavior and in-place editing.
 */
Drupal.behaviors.ipe = {
  attach: function(context) {
    $('#ipe-view-edit-toggle').once('ipe-init', Drupal.ipe.init);
    $('#ipe-view-edit-toggle').once('ipe-toggle', Drupal.ipe.renderToggle);

    // TODO: remove this; this is to make the current prototype somewhat usable.
    $('#ipe-view-edit-toggle label').click(function() {
      $(this).prevUntil(null, ':radio').trigger('click');
    });
  }
};

Drupal.ipe.init = function() {
  Drupal.ipe.state = {};
  // We always begin in view mode.
  Drupal.ipe.state.isViewing = true;
  Drupal.ipe.state.entityBeingHighlighted = [];
  Drupal.ipe.state.fieldBeingHighlighted = [];
  Drupal.ipe.state.fieldBeingEdited = [];
  Drupal.ipe.state.higlightedEditable = null;
  Drupal.ipe.state.editedEditable = null;
  Drupal.ipe.state.queues = {};

  // Build inventory.
  var IDMapper = function() { return Drupal.ipe.getID($(this)); };
  Drupal.ipe.state.entities = Drupal.ipe.findEditableEntities().map(IDMapper);
  Drupal.ipe.state.fields = Drupal.ipe.findEditableFields().map(IDMapper);
  console.log('Entities:', Drupal.ipe.state.entities.length, ';', Drupal.ipe.state.entities);
  console.log('Fields:', Drupal.ipe.state.fields.length, ';', Drupal.ipe.state.fields);

  // Form preloader.
  Drupal.ipe.state.queues.preload = Drupal.ipe.findEditableFields().filter('.ipe-type-form').map(IDMapper);
  console.log('Fields with (server-generated) forms:', Drupal.ipe.state.queues.preload);

  // Transition between view/edit states.
  $("#ipe-view-edit-toggle input").click(function() {
    var wasViewing = Drupal.ipe.state.isViewing;
    var isViewing  = Drupal.ipe.state.isViewing = (this.value == "view");

    if (wasViewing && !isViewing) {
      $('<div id="ipe-overlay"></div>')
      .appendTo('body')
      .bind('click', Drupal.ipe.clickOverlay);;

      var $f = Drupal.ipe.findEditableFields();
      Drupal.ipe.startEditableFields($f);
      var $e = Drupal.ipe.findEditableEntities();
      Drupal.ipe.startEditableEntities($e);

      // TODO: preload forms. We could do one request per form, but that's more
      // RTTs than needed. Instead, the server should support batch requests.
      console.log('Preloading forms that we might need!', Drupal.ipe.state.queues.preload);
    }
    else if (!wasViewing && isViewing) {
      $('#ipe-overlay, .ipe-toolbar-container, #ipe-modal').remove();
      var $f = Drupal.ipe.findEditableFields();
      Drupal.ipe.stopEditableFields($f);
      var $e = Drupal.ipe.findEditableEntities();
      Drupal.ipe.stopEditableEntities($e);
    }
    else {
      // No state change.
    }
  });
};

Drupal.ipe.renderToggle = function() {
  // TODO: fancy, "physical toggle" to switch from view to edit mode and back.
};

Drupal.ipe.findEditableEntities = function() {
  var $content = $('#content');
  return $('.ipe-entity.ipe-allowed', $content);
};

Drupal.ipe.findEditableFields = function() {
  var $content = $('#content');
  var $f = $('.ipe-field.ipe-allowed .field-item', $content);
  // Edge case: "title" pseudofield on pages with lists of nodes.
  $f = $f.add('h2.ipe-pseudofield.ipe-allowed a', $content);
  // Edge case: "title" pseudofield on node pages.
  $f = $f.add('.ipe-pseudofield.ipe-allowed h1', $content);
  return $f;
};

Drupal.ipe.getID = function($field) {
  return $field.data('ipe-id');
};

Drupal.ipe.findFieldForID = function(id) {
  var $content = $('#content');
  return $('[data-ipe-id="' + id + '"]', $content);
};


Drupal.ipe.findEntityForField = function($f) {
  return $f.parents('.node');
};

Drupal.ipe.startEditableEntities = function($e) {
  $e
  .addClass('ipe-candidate ipe-editable')
  .bind('mouseenter', function(e) {
    var $e = $(this);
    Drupal.ipe._ignoreToolbarMousing(e, function() {
      console.log('entity:mouseenter');
      Drupal.ipe.startHighlightEntity($e);
    });
  })
  .bind('mouseleave', function(e) {
    var $e = $(this);
    Drupal.ipe._ignoreToolbarMousing(e, function() {
      console.log('entity:mouseleave');
      Drupal.ipe.stopHighlightEntity($e);
    });
  });
};

Drupal.ipe.stopEditableEntities = function($e) {
  $e
  .removeClass('ipe-candidate ipe-editable ipe-highlighted')
  .unbind('mouseenter')
  .unbind('mouseleave');
};

Drupal.ipe.startEditableFields = function($f) {
  $f
  .addClass('ipe-candidate ipe-editable')
  .bind('mouseenter', function(e) {
    var $f = $(this);
    Drupal.ipe._ignoreToolbarMousing(e, function() {
      console.log('field:mouseenter');
      if (!$f.hasClass('ipe-editing')) {
        Drupal.ipe.startHighlightField($f);
      }
      // Prevents the entity's mouse enter event from firing, in case their borders are one and the same.
      e.stopPropagation();
    });
  })
  .bind('mouseleave', function(e) {
    var $f = $(this);
    Drupal.ipe._ignoreToolbarMousing(e, function() {
      console.log('field:mouseleave');
      if (!$f.hasClass('ipe-editing')) {
        Drupal.ipe.stopHighlightField($f);
        // Leaving a field won't trigger the mouse enter event for the entity
        // because the entity contains the field. Hence, do it manually.
        var $e = Drupal.ipe.findEntityForField($f);
        Drupal.ipe.startHighlightEntity($e);
      }
      // Prevent triggering the entity's mouse leave event.
      e.stopPropagation();
    });
  })
  .bind('click', function() { Drupal.ipe.startEditField($(this)); return false; })
  // Some transformations are field-specific.
  .map(function() {
    // This does not get stripped when going back to view mode. The only way
    // this could possibly break, is when fields' background colors can change
    // on-the-fly, while a visitor is reading the page.
    $(this).css('background-color', Drupal.ipe._getBgColor($(this)));
  }); 
};

Drupal.ipe.stopEditableFields = function($f) {
  $f
  .removeClass('ipe-candidate ipe-editable ipe-highlighted ipe-editing ipe-belowoverlay')
  .unbind('mouseenter mouseleave click ipe-content-changed')
  .removeAttr('contenteditable')
  .removeData(['ipe-content-original', 'ipe-content-changed']);
};

Drupal.ipe.clickOverlay = function(e) {
  console.log('clicked overlay');

  if (Drupal.ipe.getModal().length == 0) {
    Drupal.ipe.getToolbar(Drupal.ipe.state.fieldBeingEdited)
    .find('a.close').trigger('click');
  }
};

Drupal.ipe.createToolbar = function($element) {
  if (Drupal.ipe.getToolbar($element).length > 0) {
    return false;
  }
  else {
    $('<div class="ipe-toolbar-container"><div class="ipe-toolbar primary" /><div class="ipe-toolbar secondary" /></div>')
    .insertBefore($element)
    .bind('mouseenter', function(e) {
      // Prevent triggering the entity's mouse enter event.
      e.stopPropagation();
    })
    .bind('mouseleave', function(e) {
      var el = $element[0];
      if (e.relatedTarget != el && !jQuery.contains(el, e.relatedTarget)) {
        console.log('triggering mouseleave on ', $element);
        $element.trigger('mouseleave');
      }
      // Prevent triggering the entity's mouse leave event.
      e.stopPropagation();
    });
    return true;
  }
};

Drupal.ipe.getToolbar = function($element) {
  return $element.prev('.ipe-toolbar-container');
};

Drupal.ipe.createModal = function(message, $actions, $field) {
  // The modal should be the only interaction element now.
  $field.addClass('ipe-belowoverlay');
  Drupal.ipe.getToolbar($field).addClass('ipe-belowoverlay');

  $('<div id="ipe-modal"><div class="main"><p></p></div><div class="actions"></div></div>')
  .appendTo('body')
  .find('.main p').text(message).end()
  .find('.actions').append($actions);
};

Drupal.ipe.getModal = function() {
  return $('#ipe-modal');
};

Drupal.ipe.removeModal = function() {
  Drupal.ipe.getModal().remove();

  // Make the other interaction elements available again.
  $('.ipe-belowoverlay').removeClass('ipe-belowoverlay');
};

Drupal.ipe.startHighlightEntity = function($e) {
  console.log('startHighlightEntity');
  if (Drupal.ipe.createToolbar($e)) {
    var label = Drupal.t('Edit !entity-label', { '!entity-label' : $e.data('ipe-entity-label') });
    var url = $e.data('ipe-entity-edit-url');
    Drupal.ipe.getToolbar($e)
    .find('.ipe-toolbar.primary:not(:has(.ipe-toolgroup.entity))')
    .append('<div class="ipe-toolgroup entity"><a href="' + url + '" class="blue-button">' + label + '</a></div>');
  }
  $e.addClass('ipe-highlighted');

  Drupal.ipe.state.entityBeingHighlighted = $e;
};

Drupal.ipe.stopHighlightEntity = function($e) {
  console.log('stopHighlightEntity');
  $e.removeClass('ipe-highlighted');

  Drupal.ipe.getToolbar($e).remove();

  Drupal.ipe.state.entityBeingHiglighted = [];
};

Drupal.ipe.startHighlightField = function($f) {
  console.log('startHighlightField');
  if (Drupal.ipe.state.entityBeingHighlighted.length > 0) {
    var $e = Drupal.ipe.findEntityForField($f);
    Drupal.ipe.stopHighlightEntity($e);
  }
  if (Drupal.ipe.createToolbar($f)) {
    var label = $f.parents('.field').data('ipe-field-label');
    Drupal.ipe.getToolbar($f)
    .find('.ipe-toolbar.primary:not(:has(.ipe-toolgroup.info))')
    .append('<div class="ipe-toolgroup info"><a href="#" class="blank-button">' + label + ' </a></div>');
  }
  $editable.addClass('ipe-highlighted');

  Drupal.ipe.state.fieldBeingHighlighted = $f;
  Drupal.ipe.state.higlightedEditable = Drupal.ipe.getID(Drupal.ipe.findFieldForEditable($editable));
};

Drupal.ipe.stopHighlightField = function($f) {
  console.log('stopHighlightField');
  if ($f.length == 0) {
    return;
  }
  else if (Drupal.ipe.state.fieldBeingEdited.length > 0 && $f[0] == Drupal.ipe.state.fieldBeingEdited[0]) {
    return;
  }

  $f.removeClass('ipe-highlighted');

  Drupal.ipe.getToolbar($f).remove()

  Drupal.ipe.state.fieldBeingHighlighted = [];
  Drupal.ipe.state.highlightedEditable = null;
};

Drupal.ipe.startEditField = function($f) {
  if (Drupal.ipe.state.fieldBeingEdited.length > 0 && Drupal.ipe.state.fieldBeingEdited[0] == $f[0]) {
    return;
  }

  console.log('startEditField: ', $f);
  if (Drupal.ipe.state.fieldBeingHighlighted[0] != $f[0]) {
    Drupal.ipe.startHighlightField($f);
  }

  $f
  .data('ipe-content-original', $f.html())
  .data('ipe-content-changed', false)
  .addClass('ipe-editing')
  .attr('contenteditable', true)
  .bind('blur keyup paste', function() {
    if ($f.html() != $f.data('ipe-content-original')) {
      $f.data('ipe-content-changed', true);
      $f.trigger('ipe-content-changed');
      console.log('changed!');
    }
  })
  .bind('ipe-content-changed', function() {
    Drupal.ipe.getToolbar($f)
    .find('a.save').addClass('blue-button').removeClass('gray-button');
  });

  // While editing, don't show *any* other field or entity as editable.
  $('.ipe-candidate').not('.ipe-editing').removeClass('ipe-editable');

  // Toolbar + toolbar event handlers.
  Drupal.ipe.getToolbar($f)
  .find('.ipe-toolbar.secondary:not(:has(.ipe-toolgroup.ops))')
  .append('<div class="ipe-toolgroup ops"><a href="#" class="save gray-button">Save</a><a href="#" class="close gray-button"><span class="close"></span></a></div>')
  .find('a.save').bind('click', function() {
    console.log('TODO: save');
    Drupal.ipe.stopEditField($f);
    return false;
  }).end()
  .find('a.close').bind('click', function() {
    // Content not changed: stop editing field.
    if (!$f.data('ipe-content-changed')) {
      Drupal.ipe.stopEditField($f);
    }
    // Content changed: show modal.
    else {
     var $actions = $('<a href="#" class="gray-button discard">Discard changes</a><a href="#" class="blue-button save">Save</a>');
     Drupal.ipe.createModal(Drupal.t('You have unsaved changes'), $actions, $f);
  
     Drupal.ipe.getModal()
     .find('a.discard').bind('click', function() {
       // Restore to original state.
       $f.html($f.data('ipe-content-original'));
       $f.data('ipe-content-changed', false);

       Drupal.ipe.removeModal();
       Drupal.ipe.getToolbar($f).find('a.close').trigger('click');
     }).end()
     .find('a.save').bind('click', function() {
       Drupal.ipe.removeModal();
       Drupal.ipe.getToolbar($f).find('a.save').trigger('click');
     });
    }
    return false;
  });

  Drupal.ipe.state.fieldBeingEdited = $f;
  Drupal.ipe.state.editedEditable = Drupal.ipe.getID(Drupal.ipe.findFieldForEditable($editable));
};

Drupal.ipe.stopEditField = function($f) {
  console.log('stopEditField: ', $f);
  if ($f.length == 0) {
    return;
  }

  $f
  .removeClass('ipe-highlighted ipe-editing')
  .removeAttr('contenteditable')
  .unbind('blur keyup paste ipe-content-changed')
  .removeData(['ipe-content-original', 'ipe-content-changed']);

  // Make the other fields and entities editable again.
  $('.ipe-candidate').addClass('ipe-editable');

  Drupal.ipe.getToolbar($f).remove();

  Drupal.ipe.state.fieldBeingEdited = [];
  Drupal.ipe.state.editedEditable = null;
};

Drupal.ipe._getBgColor = function($e) {
  var c;

  if ($e == null) {
    // Fallback to white.
    return 'white';
  }
  c = $e.css('background-color');
  if (c == 'rgba(0, 0, 0, 0)') {
    // TODO: add edge case for Firefox' "transparent" here; this is a
    // browser bug: https://bugzilla.mozilla.org/show_bug.cgi?id=635724
    // TODO: test in all browsers
    return Drupal.ipe._getBgColor($e.parent());
  }
  return c;
};

Drupal.ipe._ignoreToolbarMousing = function(e, callback) {
  if ($(e.relatedTarget).parents(".ipe-toolbar-container").length > 0) {
    e.stopPropagation();
  }
  else {
    callback();
  }
};

})(jQuery);

