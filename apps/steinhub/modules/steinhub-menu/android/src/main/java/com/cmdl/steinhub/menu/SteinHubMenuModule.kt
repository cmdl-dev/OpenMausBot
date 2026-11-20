package com.cmdl.steinhub.menu

import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.widget.FrameLayout
import android.widget.PopupMenu
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class MenuItem : Record {
  @Field var title: String = ""
  @Field var icon: String? = null
}

/**
 * Shows a popup menu at a point of the screen, in density-independent pixels from the top left of the content,
 * and resolves with the index of the item chosen, or null when it is dismissed without a choice.
 */
class SteinHubMenuModule : Module() {
  private var shown: PopupMenu? = null

  override fun definition() = ModuleDefinition {
    Name("SteinHubMenu")

    AsyncFunction("show") { x: Double, y: Double, items: List<MenuItem>, promise: Promise ->
      val content = appContext.currentActivity?.findViewById<FrameLayout>(android.R.id.content)
      if (content == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      shown?.dismiss()
      val density = content.resources.displayMetrics.density
      val anchor = View(content.context)
      content.addView(anchor, FrameLayout.LayoutParams(1, 1).apply {
        leftMargin = (x * density).toInt()
        topMargin = (y * density).toInt()
      })
      val menu = PopupMenu(content.context, anchor, Gravity.NO_GRAVITY)
      items.forEachIndexed { index, item -> menu.menu.add(0, index, index, item.title) }
      var chosen: Int? = null
      menu.setOnMenuItemClickListener { item ->
        chosen = item.itemId
        true
      }
      menu.setOnDismissListener {
        content.removeView(anchor)
        if (shown === menu) shown = null
        promise.resolve(chosen)
      }
      shown = menu
      anchor.post {
        content.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
        menu.show()
      }
    }.runOnQueue(Queues.MAIN)
  }
}
