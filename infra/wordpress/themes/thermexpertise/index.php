<?php
/**
 * Main fallback template (blog/archive listing).
 *
 * @package thermexpertise
 */

get_header();
?>

<section class="page-hero">
	<div class="container">
		<h1><?php is_home() ? bloginfo( 'name' ) : the_archive_title(); ?></h1>
	</div>
</section>

<section class="section">
	<div class="container">
		<?php if ( have_posts() ) : ?>
			<div class="services">
				<?php
				while ( have_posts() ) :
					the_post();
					?>
					<article class="service-card">
						<h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
						<p><?php echo esc_html( wp_trim_words( get_the_excerpt(), 28 ) ); ?></p>
						<a class="btn btn--outline" href="<?php the_permalink(); ?>"><?php esc_html_e( 'Read more', 'thermexpertise' ); ?></a>
					</article>
					<?php
				endwhile;
				?>
			</div>
			<div style="margin-top:40px;text-align:center"><?php the_posts_pagination(); ?></div>
		<?php else : ?>
			<p style="text-align:center"><?php esc_html_e( 'Nothing found.', 'thermexpertise' ); ?></p>
		<?php endif; ?>
	</div>
</section>

<?php
get_footer();
