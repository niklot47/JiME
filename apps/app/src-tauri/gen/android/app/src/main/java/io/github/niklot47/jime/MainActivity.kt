package io.github.niklot47.jime

import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  private val handler = Handler(Looper.getMainLooper())
  private val rehide = Runnable { hideSystemBars() }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // a game screen: draw under the camera cutout too, and keep the screen on while the app is in front
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    // EMUI and others bring the bars back without a focus change: hide them again a moment after they appear
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { v, insets ->
      if (insets.isVisible(WindowInsetsCompat.Type.systemBars())) {
        handler.removeCallbacks(rehide)
        handler.postDelayed(rehide, 2500)
      }
      ViewCompat.onApplyWindowInsets(v, insets)
    }
    hideSystemBars()
  }

  override fun onResume() {
    super.onResume()
    hideSystemBars()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    // the bars come back after dialogs (file picker, keyboard) and app switches
    if (hasFocus) hideSystemBars()
  }

  /** Immersive mode: status and navigation bars hidden, a swipe from the edge shows them for a moment */
  private fun hideSystemBars() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val c = WindowInsetsControllerCompat(window, window.decorView)
    c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    c.hide(WindowInsetsCompat.Type.systemBars())
  }
}
